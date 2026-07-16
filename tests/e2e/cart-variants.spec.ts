import { expect, test } from "@playwright/test";

test("buyer selects a variant and carries it through the persistent cart", async ({ page }) => {
  await page.goto("/ama-market/products/11111111-1111-4111-8111-111111111114", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("radio", { name: /Large/ })).toBeChecked();
  await page.getByRole("button", { name: "Add to cart" }).click();
  const cart = page.getByRole("link", { name: "View cart · 1 item" });
  await expect(cart).toBeVisible();
  await cart.click();
  await expect(page.getByRole("heading", { name: "Complete your order" })).toBeVisible();
  await expect(page.getByText("Large", { exact: true })).toBeVisible();
  await expect(page.getByText("GHS 145.00").first()).toBeVisible();
});
