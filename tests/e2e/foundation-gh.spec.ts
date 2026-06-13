import { expect, test } from "@playwright/test";

test("Ghana buyer reaches guest checkout with transparent local pricing", async ({ page }) => {
  await page.goto("/ama-market", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ama Market" })).toBeVisible();
  await expect(page.getByText("GHS 125.00")).toBeVisible();
  await page.getByRole("link", { name: /Handwoven Market Bag/ }).click();
  await page.getByRole("link", { name: "Buy now" }).click();
  await expect(page.getByRole("heading", { name: "Complete your order" })).toBeVisible();
  await expect(page.getByPlaceholder("024 123 4567")).toBeVisible();
  await expect(page.getByText(/Accra delivery/)).toBeVisible();
});
