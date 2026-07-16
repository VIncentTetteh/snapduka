import { expect, test } from "@playwright/test";

test("Nigeria buyer reaches pickup checkout with naira pricing", async ({ page }) => {
  await page.goto("/lagos-style", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Lagos Style" })).toBeVisible();
  await expect(page.getByText("₦ 22,000")).toBeVisible();
  await page.getByRole("link", { name: /Lagos Beaded Sandals/ }).click();
  await page.getByRole("link", { name: "Buy now" }).click();
  await expect(page.getByPlaceholder("0801 234 5678")).toBeVisible();
  await expect(page.getByText(/Lagos pickup/).first()).toBeVisible();
});
