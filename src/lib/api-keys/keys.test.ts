import {describe,expect,test} from "vitest";import {createApiKey,hashApiKey} from "./keys";
describe("API keys",()=>{test("shows the secret once and stores only a hash",()=>{const key=createApiKey("pepper");expect(key.token).toMatch(/^sdk_live_/);expect(key.hash).toBe(hashApiKey(key.token,"pepper"));expect(key.hash).not.toContain(key.secret)})});
