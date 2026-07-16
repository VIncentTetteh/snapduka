/**
 * Social publishing providers. Each activates only when its developer-app
 * credentials are present in the environment — until then the Accounts tab
 * shows the awaiting-approval state. Snapchat has no public posting API and
 * is intentionally absent (share flows only).
 */

export type SocialProvider = "tiktok" | "instagram" | "facebook";

export const SOCIAL_PROVIDERS: SocialProvider[] = ["tiktok", "instagram", "facebook"];

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

type ProviderEnv = { clientId: string; clientSecret: string };

function env(provider: SocialProvider): ProviderEnv | null {
  // Instagram and Facebook share one Meta developer app.
  const [idVar, secretVar] =
    provider === "tiktok"
      ? ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]
      : ["META_APP_ID", "META_APP_SECRET"];
  const clientId = process.env[idVar];
  const clientSecret = process.env[secretVar];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isSocialProviderConfigured(provider: SocialProvider): boolean {
  return env(provider) !== null;
}

export function parseSocialProvider(value: string): SocialProvider | null {
  return (SOCIAL_PROVIDERS as string[]).includes(value) ? (value as SocialProvider) : null;
}

const META_GRAPH = "https://graph.facebook.com/v19.0";

/** Where the platform sends the user after granting access. */
export function callbackUrl(origin: string, provider: SocialProvider): string {
  return `${origin}/api/social/callback/${provider}`;
}

export function authorizeUrl(
  provider: SocialProvider,
  origin: string,
  state: string,
): string {
  const config = env(provider);
  if (!config) throw new Error(`${PROVIDER_LABEL[provider]} is not configured.`);
  const redirect = callbackUrl(origin, provider);

  if (provider === "tiktok") {
    const qs = new URLSearchParams({
      client_key: config.clientId,
      response_type: "code",
      scope: "user.info.basic,video.publish",
      redirect_uri: redirect,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${qs}`;
  }

  // Meta (instagram publishing rides on Pages + IG business permissions).
  const scope =
    provider === "instagram"
      ? "instagram_basic,instagram_content_publish,pages_show_list"
      : "pages_show_list,pages_manage_posts";
  const qs = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirect,
    scope,
    state,
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${qs}`;
}

export type TokenResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalId: string;
  handle: string;
  scopes: string[];
};

export async function exchangeCode(
  provider: SocialProvider,
  origin: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenResult> {
  const config = env(provider);
  if (!config) throw new Error(`${PROVIDER_LABEL[provider]} is not configured.`);
  const redirect = callbackUrl(origin, provider);

  if (provider === "tiktok") {
    const response = await fetcher("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirect,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description ?? "TikTok token exchange failed.");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
      externalId: data.open_id,
      handle: data.open_id,
      scopes: String(data.scope ?? "").split(",").filter(Boolean),
    };
  }

  const tokenResponse = await fetcher(
    `${META_GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirect,
      code,
    })}`,
  );
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) {
    throw new Error(token.error?.message ?? "Meta token exchange failed.");
  }

  const profileResponse = await fetcher(
    `${META_GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token.access_token)}`,
  );
  const profile = await profileResponse.json();

  return {
    accessToken: token.access_token,
    refreshToken: null,
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null,
    externalId: String(profile.id ?? "unknown"),
    handle: String(profile.name ?? ""),
    scopes: [],
  };
}
