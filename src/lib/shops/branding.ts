import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const schema = z.object({
  accent: hex,
  surface: hex,
  font: z.enum(["system", "rounded", "serif"]),
});

export type ShopBranding = z.infer<typeof schema>;
export function parseBranding(input: unknown) {
  return schema.safeParse(input);
}
