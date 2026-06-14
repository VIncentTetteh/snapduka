export const socialProviders = [
  { id: "google", label: "Google" },
  { id: "facebook", label: "Facebook" },
  { id: "apple", label: "Apple" },
] as const;

export type SocialProvider = (typeof socialProviders)[number]["id"];

const providerFlags: Record<SocialProvider, string> = {
  google: "NEXT_PUBLIC_AUTH_GOOGLE_ENABLED",
  facebook: "NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED",
  apple: "NEXT_PUBLIC_AUTH_APPLE_ENABLED",
};

export function isSocialProviderEnabled(provider: SocialProvider): boolean {
  return process.env[providerFlags[provider]] === "true";
}

export function enabledSocialProviders() {
  return socialProviders.filter(({ id }) => isSocialProviderEnabled(id));
}
