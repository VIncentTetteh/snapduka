export function nextAttemptAt(now: Date, attempts: number) {
  if (attempts >= 5) return null;
  return new Date(now.getTime() + 2 ** attempts * 60_000);
}

export function shouldSendWhatsApp(consent: string, providerConfigured: boolean) {
  return consent === "granted" && providerConfigured;
}
