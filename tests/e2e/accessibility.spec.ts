import { expect, test } from "@playwright/test";

test("mobile storefront has keyboard focus and no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ama-market", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const undersized = await page.locator("button, input, select, a").evaluateAll((elements) =>
    elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.height < 40;
    }).length,
  );
  expect(undersized).toBe(0);
});
