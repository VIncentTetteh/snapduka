import nodemailer, { type Transporter } from "nodemailer";

// Gmail's submission endpoint. Port 465 is implicit TLS; 587 is STARTTLS.
// Both are accepted — `secure` is derived from the port below.
const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;
const IMPLICIT_TLS_PORT = 465;

// Gmail closes idle submission sockets quickly, so keep a small pool and short
// timeouts: a hung connection should fail the job (and get retried by the
// outbox) rather than stall a whole notifications batch.
const MAX_POOLED_CONNECTIONS = 3;
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

/**
 * Reads SMTP settings from the environment, defaulting to Gmail.
 *
 * Returns null when credentials are absent so callers can fall back to the
 * webhook transport instead of throwing at import time.
 */
function readSmtpConfig(): SmtpConfig | null {
  const user = process.env.EMAIL_SMTP_USER;
  const password = process.env.EMAIL_SMTP_PASSWORD;
  if (!user || !password) return null;

  const port = Number(process.env.EMAIL_SMTP_PORT || DEFAULT_SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) return null;

  // Gmail rewrites the From header to the authenticated mailbox unless the
  // address is a verified "Send mail as" alias, so default From to the user.
  const fromAddress = process.env.EMAIL_FROM_EMAIL || user;
  const fromName = process.env.EMAIL_FROM_NAME?.replace(/["\r\n]/g, "").trim();

  return {
    host: process.env.EMAIL_SMTP_HOST || DEFAULT_SMTP_HOST,
    port,
    user,
    password,
    from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
  };
}

let pooled: { key: string; transporter: Transporter } | null = null;

/** Reuses one pooled transporter per distinct SMTP configuration. */
function transporterFor(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.user}:${config.password}`;
  if (pooled?.key === key) return pooled.transporter;
  pooled?.transporter.close();

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === IMPLICIT_TLS_PORT,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: MAX_POOLED_CONNECTIONS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  pooled = { key, transporter };
  return transporter;
}

/**
 * Nodemailer failures carry the raw SMTP dialogue, which can include the AUTH
 * exchange and the recipient address. Only the short, non-sensitive error code
 * (EAUTH, ECONNECTION, ETIMEDOUT, …) is safe to surface into
 * notifications.last_error or a log line.
 */
function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z_]{3,20}$/.test(code) ? ` (${code})` : "";
}

export async function sendEmail(recipient: string, subject: string, text: string) {
  const config = readSmtpConfig();
  if (config) {
    try {
      await transporterFor(config).sendMail({ from: config.from, to: recipient, subject, text });
    } catch (error) {
      throw new Error(`Email provider rejected the notification.${safeErrorCode(error)}`);
    }
    return { delivered: true };
  }

  if (!process.env.EMAIL_WEBHOOK_URL) return { delivered: false, reason: "not_configured" };
  const response = await fetch(process.env.EMAIL_WEBHOOK_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: recipient, subject, text }),
  });
  if (!response.ok) throw new Error("Email provider rejected the notification.");
  return { delivered: true };
}

/**
 * Opens an SMTP session and authenticates without sending mail. Used by
 * `scripts/send-test-email.mjs` and useful as a deploy-time config check.
 */
export async function verifyEmailTransport() {
  const config = readSmtpConfig();
  if (!config) return { ok: false, reason: "not_configured" };
  try {
    await transporterFor(config).verify();
  } catch (error) {
    return { ok: false, reason: `smtp_verify_failed${safeErrorCode(error)}` };
  }
  return { ok: true, host: config.host, port: config.port, from: config.from };
}
