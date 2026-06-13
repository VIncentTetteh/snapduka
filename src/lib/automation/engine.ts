export type AutomationRule={event:string;conditions:Record<string,string|number|boolean>;action:{type:string}};
export function evaluateAutomation(rule:AutomationRule,event:{type:string;data:Record<string,unknown>;depth:number}){if(event.depth>=4||rule.event!==event.type)return false;return Object.entries(rule.conditions).every(([key,value])=>event.data[key]===value)}
