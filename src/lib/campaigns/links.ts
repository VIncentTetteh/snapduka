/**
 * Campaign tokens are slugged from a seller-supplied name, so they have to be
 * coerced into the shape `campaign_links_token_shape_check` accepts.
 *
 * There used to be a `campaignUrl` here that built `?campaign=<token>` against
 * the storefront. That URL skips /l/{token}, which is the only thing that
 * records a click and sets the signed attribution cookie — so links built with
 * it silently produced no click rows and landed every order as
 * source='fallback'. Use `shortLinkUrl` from @snapduka/core instead.
 */
export function normalizeCampaignToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
