/**
 * Voice-note transcription. The vendor is undecided (GhanaNLP/Khaya, Google
 * Chirp, a Whisper-class model), to be chosen on Twi/Pidgin word error rate
 * over real samples — so this is an interface and a default that reports
 * `not_configured`. Until one is wired in (and `wa_agent_voice` is on), the
 * agent answers a voice note with "please type".
 */

export type TranscriptionResult =
  | { ok: true; text: string; language?: "en" | "pcm" | "tw" }
  | { ok: false; reason: "not_configured" | "unsupported_audio" | "failed" };

export type Transcriber = {
  transcribe(input: {
    audio: Uint8Array;
    mimeType: string;
    languageHint?: "en" | "pcm" | "tw";
  }): Promise<TranscriptionResult>;
};

export const notConfiguredTranscriber: Transcriber = {
  async transcribe() {
    return { ok: false, reason: "not_configured" };
  },
};

let active: Transcriber = notConfiguredTranscriber;

/** The transcriber in use. Swap with `setTranscriber` once a vendor is chosen. */
export function getTranscriber(): Transcriber {
  return active;
}

export function setTranscriber(transcriber: Transcriber): void {
  active = transcriber;
}

export function isTranscriberConfigured(): boolean {
  return active !== notConfiguredTranscriber;
}
