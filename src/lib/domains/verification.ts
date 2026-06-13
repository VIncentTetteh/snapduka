export function normalizeHostname(host: string) {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function domainChallenge(token: string) {
  return { type: "TXT" as const, name: "_snapduka", value: `snapduka-verification=${token}` };
}
