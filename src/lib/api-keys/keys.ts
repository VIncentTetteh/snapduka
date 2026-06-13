import {createHash,randomBytes,randomUUID} from "node:crypto";
export function hashApiKey(token:string,pepper:string){return createHash("sha256").update(`${pepper}:${token}`).digest("hex")}
export function createApiKey(pepper:string){const id=randomUUID();const secret=randomBytes(24).toString("base64url");const token=`sdk_live_${id}_${secret}`;return{id,secret,token,prefix:token.slice(0,24),hash:hashApiKey(token,pepper)}}
