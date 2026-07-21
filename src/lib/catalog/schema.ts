import { z } from "zod";

import { isSafeHttpUrl } from "@/lib/catalog/video";

const MINOR_UNIT_PATTERN = /^\d{1,12}$/;

const productSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a product name.").max(120),
    description: z.string().trim().max(5_000).optional().default(""),
    price: z.string().regex(MINOR_UNIT_PATTERN, "Enter a whole minor-unit amount."),
    costPrice: z.string().optional().default(""),
    compareAtPrice: z.string().optional().default(""),
    currency: z.enum(["GHS", "NGN", "XOF"], {
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
    videoUrl: z.string().trim().optional().default(""),
  })
  .superRefine((value, context) => {
    if (
      value.inventoryPolicy === "track" &&
      !MINOR_UNIT_PATTERN.test(value.stockQuantity)
    ) {
      context.addIssue({
        code: "custom",
        path: ["stockQuantity"],
        message: "Enter the available stock.",
      });
    }
    if (value.costPrice && !MINOR_UNIT_PATTERN.test(value.costPrice)) {
      context.addIssue({
        code: "custom",
        path: ["costPrice"],
        message: "Enter a whole minor-unit amount.",
      });
    }
    if (value.compareAtPrice) {
      if (!MINOR_UNIT_PATTERN.test(value.compareAtPrice)) {
        context.addIssue({
          code: "custom",
          path: ["compareAtPrice"],
          message: "Enter a whole minor-unit amount.",
        });
      } else if (
        MINOR_UNIT_PATTERN.test(value.price) &&
        Number(value.compareAtPrice) <= Number(value.price)
      ) {
        context.addIssue({
          code: "custom",
          path: ["compareAtPrice"],
          message: "Must be higher than the sale price.",
        });
      }
    }
    if (value.videoUrl && !isSafeHttpUrl(value.videoUrl)) {
      context.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "Enter a valid http(s) video link.",
      });
    }
  });

export type ProductInput = {
  name?: string;
  description?: string;
  price?: string;
  costPrice?: string;
  compareAtPrice?: string;
  currency?: string;
  inventoryPolicy?: string;
  stockQuantity?: string;
  sku?: string;
  status?: string;
  videoUrl?: string;
};

export type ParsedProduct = {
  name: string;
  description: string;
  priceMinor: number;
  costMinor: number | null;
  compareAtPriceMinor: number | null;
  currency: "GHS" | "NGN" | "XOF";
  inventoryPolicy:
    | "track"
    | "continue_selling"
    | "deny_when_out_of_stock";
  stockQuantity: number | null;
  sku: string;
  status: "draft" | "active";
  videoUrl: string;
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
      costMinor: parsed.data.costPrice ? Number(parsed.data.costPrice) : null,
      compareAtPriceMinor: parsed.data.compareAtPrice ? Number(parsed.data.compareAtPrice) : null,
      currency: parsed.data.currency,
      inventoryPolicy: parsed.data.inventoryPolicy,
      stockQuantity:
        parsed.data.inventoryPolicy === "track"
          ? Number(parsed.data.stockQuantity)
          : null,
      sku: parsed.data.sku,
      status: parsed.data.status,
      videoUrl: parsed.data.videoUrl,
    },
  };
}
