import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  acceptLanguage: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sd_locale" && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }),
  headers: async () => new Headers(mocks.acceptLanguage ? { "accept-language": mocks.acceptLanguage } : {}),
}));

import { getRequestLocale, getRequestMessages } from "./locale";

describe("getRequestLocale", () => {
  beforeEach(() => {
    mocks.cookie = undefined;
    mocks.acceptLanguage = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the sd_locale cookie first", async () => {
    mocks.cookie = "fr";
    mocks.acceptLanguage = "en-US";
    await expect(getRequestLocale("GH")).resolves.toBe("fr");
  });

  it("then Accept-Language", async () => {
    mocks.acceptLanguage = "fr-CI,fr;q=0.9";
    await expect(getRequestLocale("GH")).resolves.toBe("fr");
  });

  it("then the country default", async () => {
    await expect(getRequestLocale("CI")).resolves.toBe("fr");
    await expect(getRequestLocale(null)).resolves.toBe("en");
  });

  it("serves English for draft keys unless I18N_SHOW_DRAFTS is on", async () => {
    mocks.cookie = "pcm";
    expect((await getRequestMessages()).unavailable).toBe("Unavailable");
    vi.stubEnv("I18N_SHOW_DRAFTS", "true");
    expect((await getRequestMessages()).unavailable).toBe("E no dey");
  });
});
