import {randomUUID} from "node:crypto";import type {CourierAdapter} from "./types";
export class ManualCourierAdapter implements CourierAdapter{
 async quote(input:{orderId:string;currency:string;amountMinor?:number}){return [{id:`manual:${input.orderId}`,provider:"manual",service:"Seller-arranged delivery",amountMinor:input.amountMinor??0,currency:input.currency,expiresAt:new Date(Date.now()+86_400_000).toISOString()}]}
 async book(input:{orderId:string;quoteId:string;trackingNumber?:string;trackingUrl?:string}){return {id:randomUUID(),provider:"manual",trackingNumber:input.trackingNumber??`MAN-${input.orderId.slice(0,8).toUpperCase()}`,trackingUrl:input.trackingUrl??null,labelUrl:null,status:"booked" as const}}
 async cancel(shipmentId:string){void shipmentId;return}
}
