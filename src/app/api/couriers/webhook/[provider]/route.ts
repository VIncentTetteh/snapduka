import {createHash,timingSafeEqual} from "node:crypto";import {NextResponse} from "next/server";import {createAdminClient} from "@/lib/supabase/admin";
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){const{provider}=await params;const secret=process.env[`COURIER_${provider.toUpperCase()}_WEBHOOK_SECRET`];const authHeader=request.headers.get("authorization");if(!secret||!authHeader){return NextResponse.json({error:"Unauthorized"},{status:401});}const expected=Buffer.from(`Bearer ${secret}`);const received=Buffer.from(authHeader);if(expected.length!==received.length||!timingSafeEqual(expected,received)){return NextResponse.json({error:"Unauthorized"},{status:401});}const payload=await request.json();const tracking=payload.trackingNumber;const status=payload.status;if(typeof tracking!=="string"||!["in_transit","delivered","cancelled","failed"].includes(status))return NextResponse.json({error:"Invalid event."},{status:400});const admin=createAdminClient();const{data:shipment}=await admin.from("shipments").select("id,seller_account_id,order_id").eq("provider",provider).eq("tracking_number",tracking).single();if(!shipment)return NextResponse.json({received:true,applied:false});const eventKey=String(payload.id??createHash("sha256").update(JSON.stringify(payload)).digest("hex"));const{error}=await admin.from("shipment_events").insert({shipment_id:shipment.id,seller_account_id:shipment.seller_account_id,event_key:eventKey,status,payload});if(error?.code==="23505")return NextResponse.json({received:true,applied:false});await admin.from("shipments").update({status}).eq("id",shipment.id);
// Shipment progress drives the buyer's order timeline.
const orderStatus=status==="in_transit"?"dispatched":status==="delivered"?"fulfilled":null;
if(orderStatus){
  const{data:order}=await admin.from("orders").select("id,fulfillment_status").eq("id",shipment.order_id).maybeSingle();
  const advanceable=orderStatus==="dispatched"?["unconfirmed","confirmed","preparing"]:["unconfirmed","confirmed","preparing","ready_for_pickup","dispatched"];
  if(order&&advanceable.includes(order.fulfillment_status)){
    await admin.from("orders").update({fulfillment_status:orderStatus}).eq("id",order.id);
  }
}
await admin.from("order_events").insert({order_id:shipment.order_id,seller_account_id:shipment.seller_account_id,event_type:`shipment_${status}`,actor_type:"provider",buyer_visible:true,data:{trackingNumber:tracking,provider}});
return NextResponse.json({received:true,applied:true})}
