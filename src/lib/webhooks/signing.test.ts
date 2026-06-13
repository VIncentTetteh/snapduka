import {describe,expect,test} from "vitest";import {signWebhook,verifyWebhook} from "./signing";
describe("outbound webhooks",()=>{test("uses timestamped HMAC signatures",()=>{const signed=signWebhook('{"ok":true}',"secret",1700000000);expect(verifyWebhook('{"ok":true}',signed,"secret",1700000010)).toBe(true);expect(verifyWebhook('{"ok":false}',signed,"secret",1700000010)).toBe(false)})});
