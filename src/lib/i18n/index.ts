import {en} from "./en";import {fr} from "./fr";import type {CountryCode,CurrencyCode} from "@/lib/countries/types";
export type Locale="en"|"fr";
export function dictionary(locale:string){return locale.toLowerCase().startsWith("fr")?fr:en}
export function formatMoney(minor:number,currency:CurrencyCode,locale="en-GH"){const digits=currency==="XOF"?0:2;return new Intl.NumberFormat(locale,{style:"currency",currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(currency==="XOF"?minor:minor/100)}
export function normalizePhone(value:string,country:CountryCode){const config={GH:"+233",NG:"+234",CI:"+225"}[country];const national=value.replace(/\D/g,"");const digits=country==="CI"?national:national.replace(/^0/,"");return value.trim().startsWith("+")?`+${value.replace(/\D/g,"")}`:`${config}${digits}`}
