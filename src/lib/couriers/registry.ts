import {ManualCourierAdapter} from "./manual";import type {CourierAdapter} from "./types";
const providers:Record<string,()=>CourierAdapter>={manual:()=>new ManualCourierAdapter()};
export function courierAdapter(provider:string){const factory=providers[provider];if(!factory)throw new Error(`Unsupported courier provider: ${provider}`);return factory()}
