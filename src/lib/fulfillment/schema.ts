import { z } from "zod";

const schema = z.object({
  type: z.enum(["delivery", "pickup"]),
  name: z.string().trim().min(2).max(100),
  feeMinor: z.string().regex(/^\d+$/),
  instructions: z.string().trim().max(1000),
});

export function parseFulfillmentMethod(input: Record<string, string>) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  return {
    success: true as const,
    data: { ...parsed.data, feeMinor: Number(parsed.data.feeMinor) },
  };
}
