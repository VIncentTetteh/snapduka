/**
 * Verifies the Gmail SMTP credentials in .env.local end to end.
 *
 *   pnpm email:test                    # sends to EMAIL_SMTP_USER
 *   pnpm email:test someone@example.com
 *
 * This exercises the same env vars and endpoint defaults as
 * src/lib/notifications/email.ts. It talks to nodemailer directly because the
 * app module is TypeScript; the delivery logic itself is unit-tested in
 * src/lib/notifications/email.test.ts.
 */
import nodemailer from "nodemailer";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;
const IMPLICIT_TLS_PORT = 465;

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall through to the ambient environment (CI, `vercel env pull`, etc.).
}

const user = process.env.EMAIL_SMTP_USER;
const password = process.env.EMAIL_SMTP_PASSWORD;
if (!user || !password) {
  console.error("Missing EMAIL_SMTP_USER or EMAIL_SMTP_PASSWORD — see .env.example.");
  process.exit(1);
}

const host = process.env.EMAIL_SMTP_HOST || DEFAULT_SMTP_HOST;
const port = Number(process.env.EMAIL_SMTP_PORT || DEFAULT_SMTP_PORT);
const fromAddress = process.env.EMAIL_FROM_EMAIL || user;
const fromName = process.env.EMAIL_FROM_NAME?.replace(/["\r\n]/g, "").trim();
const recipient = process.argv[2] || user;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === IMPLICIT_TLS_PORT,
  auth: { user, pass: password },
});

try {
  await transporter.verify();
  console.log(`Authenticated to ${host}:${port} as ${user}`);
  const info = await transporter.sendMail({
    from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
    to: recipient,
    subject: "SnapDuka SMTP test",
    text: "If you are reading this, transactional email is configured correctly.",
  });
  console.log(`Sent to ${recipient} (${info.messageId})`);
} catch (error) {
  // Nodemailer errors carry the raw SMTP dialogue; print only the code and a
  // hint so a shared terminal or CI log never captures the app password.
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  console.error(`SMTP failure: ${code}`);
  if (code === "EAUTH") {
    console.error("Gmail rejected the login. Confirm 2-Step Verification is on and the value is a 16-character App Password, not the account password.");
  }
  process.exitCode = 1;
} finally {
  transporter.close();
}
