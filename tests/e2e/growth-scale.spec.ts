import {expect,test} from "@playwright/test";

test("campaign attribution survives storefront navigation",async({page})=>{
  await page.goto("/ama-market?campaign=tiktok-launch");
  await page.getByRole("link",{name:/Handwoven Market Bag/}).click();
  await expect(page).toHaveURL(/campaign=tiktok-launch/);
  await page.getByRole("link",{name:"Buy now"}).click();
  await expect(page).toHaveURL(/campaign=tiktok-launch/);
  await expect(page.getByPlaceholder("Promotion code (optional)")).toBeVisible();
});

test("promotion is validated and snapshotted on an offline order",async({request})=>{
  const response=await request.post("/api/checkout/orders",{data:{
    shopId:"11111111-1111-4111-8111-111111111113",fulfillmentMethodId:"11111111-1111-4111-8111-111111111115",
    idempotencyKey:`growth-promo-${Date.now()}`,paymentMethod:"cash_on_delivery",promotionCode:"SAVE10",campaignToken:"tiktok-launch",
    buyer:{name:"Growth Buyer",email:`growth-${Date.now()}@example.com`,phone:"+233241234567",country:"GH",address:{line1:"1 Test Road",area:"Osu",city:"Accra",region:"Greater Accra"},marketingConsent:true},
    lines:[{productId:"11111111-1111-4111-8111-111111111114",quantity:1}],
  }});
  expect(response.status()).toBe(201);
  const body=await response.json();
  expect(body.discountMinor).toBe(1250);
  expect(body.totalMinor).toBe(13750);
});

test("opt-in discovery exposes no buyer PII",async({page})=>{
  await page.goto("/discover?country=GH");
  await expect(page.getByRole("link",{name:/Ama Market/})).toBeVisible();
  await expect(page.getByText(/@example.com/)).toHaveCount(0);
});

test("public APIs reject requests without scoped keys",async({request})=>{
  expect((await request.get("/api/v1/orders")).status()).toBe(401);
});
