import { z } from "zod";

const productSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a product name.").max(120),
    description: z.string().trim().max(5_000).optional().default(""),
    price: z.string().regex(/^\d+$/, "Enter a whole minor-unit amount."),
    currency: z.enum(["GHS", "NGN"], {
      message: "Use the shop currency.",
    }),
    inventoryPolicy: z.enum([
      "track",
      "continue_selling",
      "deny_when_out_of_stock",
    ]),
    stockQuantity: z.string().optional().default(""),
    sku: z.string().trim().max(80).optional().default(""),
    status: z.enum(["draft", "active"]),
  })
  .superRefine((value, context) => {
    if (
      value.inventoryPolicy === "track" &&
      !/^\d+$/.test(value.stockQuantity)
    ) {
      context.addIssue({
        code: "custom",
        path: ["stockQuantity"],
        message: "Enter the available stock.",
      });
    }
  });

export type ProductInput = {
  name?: string;
  description?: string;
  price?: string;
  currency?: string;
  inventoryPolicy?: string;
  stockQuantity?: string;
  sku?: string;
  status?: string;
};

export type ParsedProduct = {
  name: string;
  description: string;
  priceMinor: number;
  currency: "GHS" | "NGN";
  inventoryPolicy:
    | "track"
    | "continue_selling"
    | "deny_when_out_of_stock";
  stockQuantity: number | null;
  sku: string;
  status: "draft" | "active";
};

export type ProductParseResult =
  | { success: true; data: ParsedProduct }
  | { success: false; fieldErrors: Record<string, string[]> };

export function parseProductInput(input: ProductInput): ProductParseResult {
  const parsed = productSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  return {
    success: true,
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      priceMinor: Number(parsed.data.price),
      currency: parsed.data.currency,
      inventoryPolicy: parsed.data.inventoryPolicy,
      stockQuantity:
        parsed.data.inventoryPolicy === "track"
          ? Number(parsed.data.stockQuantity)
          : null,
      sku: parsed.data.sku,
      status: parsed.data.status,
    },
  };
}
