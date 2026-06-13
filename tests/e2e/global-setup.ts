import { createClient } from "@supabase/supabase-js";

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Local Supabase credentials are required. Run pnpm test:e2e.");
  }
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const fixtures = [
    {
      userId:"11111111-1111-4111-8111-111111111111", sellerId:"11111111-1111-4111-8111-111111111112",
      shopId:"11111111-1111-4111-8111-111111111113", productId:"11111111-1111-4111-8111-111111111114",
      methodId:"11111111-1111-4111-8111-111111111115", email:"ghana-demo@example.com", country:"GH",
      phone:"+233241234567", seller:"Ama Demo", slug:"ama-market", shop:"Ama Market", currency:"GHS",
      product:"Handwoven Market Bag", productSlug:"handwoven-market-bag", price:12500, policy:"track", stock:10,
      methodType:"delivery", method:"Accra delivery", fee:2500, instructions:"Seller will confirm the delivery time.",
    },
    {
      userId:"22222222-2222-4222-8222-222222222222", sellerId:"22222222-2222-4222-8222-222222222223",
      shopId:"22222222-2222-4222-8222-222222222224", productId:"22222222-2222-4222-8222-222222222225",
      methodId:"22222222-2222-4222-8222-222222222226", email:"nigeria-demo@example.com", country:"NG",
      phone:"+2348012345678", seller:"Ada Demo", slug:"lagos-style", shop:"Lagos Style", currency:"NGN",
      product:"Lagos Beaded Sandals", productSlug:"lagos-beaded-sandals", price:2200000, policy:"continue_selling", stock:null,
      methodType:"pickup", method:"Lagos pickup", fee:0, instructions:"Seller will share the pickup time.",
    },
  ] as const;
  for (const item of fixtures) {
    await admin.auth.admin.createUser({ id:item.userId, email:item.email, email_confirm:true });
    await admin.from("seller_accounts").upsert({
      id:item.sellerId,auth_user_id:item.userId,country:item.country,status:"active",is_active:true,
      contact_name:item.seller,contact_email:item.email,contact_phone:item.phone,
    });
    await admin.from("shops").upsert({
      id:item.shopId,seller_account_id:item.sellerId,slug:item.slug,display_name:item.shop,
      legal_name:`${item.shop} Ltd`,country:item.country,currency:item.currency,status:"published",published_at:new Date().toISOString(),
    });
    await admin.from("products").upsert({
      id:item.productId,shop_id:item.shopId,seller_account_id:item.sellerId,name:item.product,slug:item.productSlug,
      description:`${item.product} from ${item.shop}.`,currency:item.currency,price_minor:item.price,status:"active",
      inventory_policy:item.policy,stock_quantity:item.stock,published_at:new Date().toISOString(),
    });
    await admin.from("fulfillment_methods").upsert({
      id:item.methodId,shop_id:item.shopId,seller_account_id:item.sellerId,type:item.methodType,
      name:item.method,fee_minor:item.fee,instructions:item.instructions,active:true,
    });
  }
}
