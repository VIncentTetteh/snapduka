export type CourierQuote={id:string;provider:string;service:string;amountMinor:number;currency:string;expiresAt:string};
export type Shipment={id:string;provider:string;trackingNumber:string;trackingUrl:string|null;labelUrl:string|null;status:"booked"|"in_transit"|"delivered"|"cancelled"};
export interface CourierAdapter{quote(input:{orderId:string;currency:string;amountMinor?:number}):Promise<CourierQuote[]>;book(input:{orderId:string;quoteId:string;trackingNumber?:string;trackingUrl?:string}):Promise<Shipment>;cancel(shipmentId:string):Promise<void>}
