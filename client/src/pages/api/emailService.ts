// src/pages/api/emailService.ts
import * as nodemailer from "nodemailer";
import https from "node:https";
import { URL } from "node:url";

/* ----------------------------- Env & Helpers ----------------------------- */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Basic HTML escape to avoid weird rendering if names contain < or &
function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Convert HTML to a simple text alternative (deliverability + accessibility)
function htmlToText(html: string): string {
  return html
    .replace(/\n+/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// TTL helpers (with sane bounds)
const toIntEnv = (v: string | undefined, fallback: number, min = 1, max = 365 * 24 * 60) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.floor(n));
};

const RESET_TTL_MIN = toIntEnv(process.env.PASSWORD_RESET_TTL_MIN, 15, 1, 60 * 24);
const VERIFY_TTL_HOURS = toIntEnv(process.env.EMAIL_VERIFY_TTL_HOURS, 24, 1, 24 * 365);

// Prefer explicit FRONTEND_URL or DEPLOY_PUBLIC_ORIGIN; otherwise blank to avoid leaking localhost
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.DEPLOY_PUBLIC_ORIGIN || "";
const EMAIL_FROM = required("EMAIL_FROM"); // e.g. "Adonai & Grace Inc. <your@gmail.com>"
const REPLY_TO = process.env.REPLY_TO || ""; // optional

/* ------------------------- Provider Config & Decide ------------------------ */

const RESEND_API_KEY  = process.env.RESEND_API_KEY || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const BREVO_API_KEY    = process.env.BREVO_API_KEY || "";

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "").toLowerCase(); // 'brevoapi' | 'resend' | 'sendgrid' | 'smtp'

/* --------------------------------- SMTP ---------------------------------- */
// Optional: only used if API providers are absent/fail AND SMTP_* provided
const SMTP_HOST = process.env.SMTP_HOST;
const PRIMARY_PORT = (() => {
  const p = Number(process.env.SMTP_PORT);
  return Number.isFinite(p) ? p : 587;
})();
const PRIMARY_SECURE = String(process.env.SMTP_SECURE || "false") === "true"; // implicit TLS when true
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

function makeTransport(port: number, secure: boolean) {
  const options: nodemailer.TransportOptions = {
    host: SMTP_HOST,
    port,
    secure,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: false,
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") === "true",
    },
    logger: process.env.SMTP_DEBUG === "true",
    debug: process.env.SMTP_DEBUG === "true",
  } as any;
  return nodemailer.createTransport(options as any);
}

let transporter: nodemailer.Transporter | null = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  try {
    transporter = makeTransport(PRIMARY_PORT, PRIMARY_SECURE);
  } catch (e) {
    console.error("[email] Failed to initialize SMTP transporter:", e);
  }
} else {
  console.log("[email] SMTP credentials not fully provided; will rely on API provider if available.");
}

/* ------------------------------- HTTP JSON -------------------------------- */

function httpsJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyObj: any
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || 443,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("HTTPS request timeout")));
    req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

/* -------------------------------- Providers ------------------------------- */

// Brevo HTTPS API (port 443 — good when SMTP ports are blocked)
async function sendViaBrevoAPI(to: string, subject: string, html: string) {
  const fromEmail = (EMAIL_FROM.match(/<([^>]+)>/)?.[1] || EMAIL_FROM).trim();
  const fromName  = EMAIL_FROM.replace(/<[^>]+>/g, "").trim();

  const payload: any = {
    sender: { email: fromEmail, name: fromName || undefined },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: htmlToText(html),
  };
  if (REPLY_TO) payload.replyTo = { email: REPLY_TO };

  const resp = await httpsJson(
    "https://api.brevo.com/v3/smtp/email",
    "POST",
    { "api-key": BREVO_API_KEY },
    payload
  );
  if (resp.status >= 200 && resp.status < 300) return true;
  throw new Error(`BREVO_API_${resp.status}:${resp.body.slice(0, 200)}`);
}

async function sendViaResend(to: string, subject: string, html: string) {
  const payload: any = {
    from: EMAIL_FROM,
    to: [to],
    subject,
    html,
    text: htmlToText(html),
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;

  const resp = await httpsJson(
    "https://api.resend.com/emails",
    "POST",
    { Authorization: `Bearer ${RESEND_API_KEY}` },
    payload
  );
  if (resp.status >= 200 && resp.status < 300) return true;
  throw new Error(`RESEND_${resp.status}:${resp.body.slice(0, 200)}`);
}

async function sendViaSendGrid(to: string, subject: string, html: string) {
  const fromAddress = EMAIL_FROM.replace(/.*<([^>]+)>.*/, "$1");
  const payload: any = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromAddress },
    subject,
    content: [
      { type: "text/plain", value: htmlToText(html) },
      { type: "text/html",  value: html },
    ],
  };
  if (REPLY_TO) payload.reply_to = { email: REPLY_TO };

  const resp = await httpsJson(
    "https://api.sendgrid.com/v3/mail/send",
    "POST",
    { Authorization: `Bearer ${SENDGRID_API_KEY}` },
    payload
  );
  if (resp.status === 202) return true;
  throw new Error(`SENDGRID_${resp.status}:${resp.body.slice(0, 200)}`);
}

async function sendMailWithFallback(to: string, subject: string, html: string) {
  if (!transporter) throw new Error("SMTP transporter unavailable (missing SMTP_* env vars)");

  const mailOptions: nodemailer.SendMailOptions = {
    from: EMAIL_FROM,
    to,
    subject,
    html,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
  };

  try {
    return await transporter.sendMail(mailOptions);
  } catch (err: any) {
    const code = err?.code || err?.errno || err?.responseCode;
    const isTimeout = code === "ETIMEDOUT" || code === "ESOCKET" || /timeout/i.test(String(err?.message || ""));
    const isConn = code === "ECONNECTION" || code === "ECONNREFUSED";

    // If primary was Gmail implicit TLS (465), try STARTTLS on 587
    if (transporter && (isTimeout || isConn) && SMTP_HOST === "smtp.gmail.com" && PRIMARY_PORT === 465) {
      console.warn("[email] Primary SMTP connection failed (465). Trying STARTTLS on 587…");
      try {
        transporter = makeTransport(587, false);
        return await transporter.sendMail(mailOptions);
      } catch (e2) {
        console.error("[email] Fallback SMTP (587) also failed:", e2);
        throw e2;
      }
    }
    console.error("[email] SMTP send failed (no fallback attempted):", err);
    throw err;
  }
}

/* ----------------------------- Orchestrator ------------------------------- */

async function sendMail(to: string, subject: string, html: string) {
  const sender = (EMAIL_FROM.match(/<([^>]+)>/)?.[1] || EMAIL_FROM).toLowerCase();

  if ((RESEND_API_KEY || SENDGRID_API_KEY || BREVO_API_KEY) && sender.endsWith("@gmail.com")) {
    console.warn("[email] Using a gmail.com From address with a provider may reduce deliverability.");
  }

  // 1) Explicit provider choice wins
  if (EMAIL_PROVIDER === "brevoapi" && BREVO_API_KEY) {
    return sendViaBrevoAPI(to, subject, html);
  }
  if (EMAIL_PROVIDER === "resend" && RESEND_API_KEY) {
    try { return await sendViaResend(to, subject, html); }
    catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("You can only send testing emails")) {
        const err = new Error("EMAIL_DOMAIN_UNVERIFIED");
        (err as any).original = e;
        throw err;
      }
      console.warn("[email] Resend (explicit) failed:", msg);
    }
  }
  if (EMAIL_PROVIDER === "sendgrid" && SENDGRID_API_KEY) {
    try { return await sendViaSendGrid(to, subject, html); }
    catch (e: any) { console.warn("[email] SendGrid (explicit) failed:", String(e)); }
  }
  if (EMAIL_PROVIDER === "smtp") {
    return sendMailWithFallback(to, subject, html);
  }

  // 2) Auto order: Brevo API → Resend → SendGrid → SMTP
  if (BREVO_API_KEY) {
    try { return await sendViaBrevoAPI(to, subject, html); }
    catch (e: any) { console.warn("[email] Brevo API failed, trying next…", String(e?.message || e)); }
  }
  if (RESEND_API_KEY) {
    try { return await sendViaResend(to, subject, html); }
    catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("You can only send testing emails")) {
        const err = new Error("EMAIL_DOMAIN_UNVERIFIED");
        (err as any).original = e;
        throw err;
      }
      console.warn("[email] Resend failed, trying SendGrid…", msg);
    }
  }
  if (SENDGRID_API_KEY) {
    try { return await sendViaSendGrid(to, subject, html); }
    catch (e2) { console.warn("[email] SendGrid failed, trying SMTP…", String(e2)); }
  }
  return sendMailWithFallback(to, subject, html);
}

/* ------------------------------ Public API -------------------------------- */

export const sendVerificationEmail = async (email: string, token: string, username: string) => {
  const safeName = escapeHtml(username || "User");
  const link = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);">
        <div style="background: rgba(251, 191, 36, 0.1); border: 2px solid #fbbf24; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">🎓</div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Adonai & Grace</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Adonai And Grace Inc.</p>
      </div>
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Welcome, ${safeName}! ✨</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">Thank you for joining Adonai And Grace Inc.! We're excited to have you as part of our educational community.</p>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px;">Please verify your email address to complete your registration and start your learning journey:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #1e3a8a; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(251, 191, 36, 0.3); transition: all 0.3s ease;">✅ Verify Email Address</a>
        </div>
        <div style="background: #fef3c7; border-left: 4px solid #fbbf24; padding: 15px; margin: 25px 0; border-radius: 8px;">
          <p style="margin: 0; color: #92400e; font-size: 14px;">⏰ <strong>Important:</strong> This verification link will expire in ${VERIFY_TTL_HOURS} hours for security purposes.</p>
        </div>
        <p style="font-size: 14px; color: #6b7280; margin: 25px 0 0; line-height: 1.5;">If you didn't create this account, please ignore this email or contact our support team.</p>
      </div>
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">"Liwanag, Kaalaman, Paglilingkod"</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Light • Knowledge • Service</p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Verify your Adonai And Grace Inc. account", html);
    console.log("Verification email queued (recipient hidden for privacy)");
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    if (msg === "EMAIL_DOMAIN_UNVERIFIED") {
      throw new Error("Email domain not verified on provider; use a provider-owned sender or finish DNS.");
    }
    console.error("Verification email send failed:", msg);
    throw new Error("Failed to send verification email");
  }
};

export const sendPasswordResetEmail = async (email: string, token: string, username: string) => {
  const safeName = escapeHtml(username || "User");
  const link = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
        <div style="background: rgba(220, 53, 69, 0.2); border: 2px solid #dc3545; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 30px;">🔐</div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Password Reset</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Adonai And Grace Inc.</p>
      </div>
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Hello ${safeName},</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">We received a request to reset your password. If you made this request, click the button below to set a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3);">🔄 Reset Password</a>
        </div>
        <div style="background: #fee2e2; border-left: 4px solid #dc3545; padding: 15px; margin: 25px 0; border-radius: 8px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">⚠️ <strong>Security Notice:</strong> This link will expire in ${RESET_TTL_MIN} minutes. If you didn't request this reset, please ignore this email.</p>
        </div>
      </div>
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">"Liwanag, Kaalaman, Paglilingkod"</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Light • Knowledge • Service</p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Reset your Adonai And Grace Inc. password", html);
    console.log("Password reset email queued (recipient hidden for privacy)");
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    if (msg === "EMAIL_DOMAIN_UNVERIFIED") {
      throw new Error("Email domain not verified on provider; use a provider-owned sender or finish DNS.");
    }
    console.error("Password reset email send failed:", msg);
    throw new Error("Failed to send password reset email");
  }
};

export const sendWelcomeEmail = async (email: string, username: string, role: string) => {
  const safeName = escapeHtml(username || "User");
  const safeRole = escapeHtml(role || "student");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
        <div style="background: rgba(34, 197, 94, 0.2); border: 2px solid #22c55e; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 30px;">🎓</div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Welcome Aboard!</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Adonai And Grace Inc.</p>
      </div>
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Congratulations, ${safeName}! 🌟</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">Your <strong>${safeRole}</strong> account has been successfully verified! You're now part of the Adonai And Grace Inc. community.</p>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px;">Get ready to explore our interactive educational content and begin your learning journey!</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3);">🚀 Start Learning Now</a>
        </div>
        <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; margin: 25px 0; border-radius: 8px;">
          <h3 style="color: #0c4a6e; margin: 0 0 10px; font-size: 18px;">What's Next?</h3>
          <ul style="margin: 0; padding-left: 20px; color: #0c4a6e;">
            <li>Explore our educational programs</li>
            <li>Access interactive learning materials</li>
            <li>Connect with fellow learners</li>
            <li>Track your progress</li>
          </ul>
        </div>
        <p style="font-size: 16px; color: #374151; margin: 25px 0 0; text-align: center;">Happy learning! 📚✨</p>
      </div>
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">"Liwanag, Kaalaman, Paglilingkod"</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Light • Knowledge • Service</p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Welcome to Adonai And Grace Inc.! 🎉", html);
    console.log("Welcome email queued (recipient hidden for privacy)");
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    if (msg === "EMAIL_DOMAIN_UNVERIFIED") {
      throw new Error("Email domain not verified on provider; use a provider-owned sender or finish DNS.");
    }
    console.error("Welcome email send failed:", msg);
    throw new Error("Failed to send welcome email");
  }
};