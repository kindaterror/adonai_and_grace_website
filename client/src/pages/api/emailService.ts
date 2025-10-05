// src/pages/api/emailService.ts
import * as nodemailer from "nodemailer";
import https from 'node:https';
import { URL } from 'node:url';

// ---- Helpers ----
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

// Centralized TTLs for copy (optional; falls back to defaults)
const toIntEnv = (v: string | undefined, fallback: number, min = 1, max = 365 * 24 * 60) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.floor(n));
};

const RESET_TTL_MIN = toIntEnv(process.env.PASSWORD_RESET_TTL_MIN, 15, 1, 60 * 24);
const VERIFY_TTL_HOURS = toIntEnv(process.env.EMAIL_VERIFY_TTL_HOURS, 24, 1, 24 * 365);

// Prefer explicit FRONTEND_URL (or DEPLOY_PUBLIC_ORIGIN) and avoid hardcoded localhost fallback
// so production emails never leak a dev URL. If neither is set we leave it blank and links will be invalid,
// which is safer than pointing users to a non-existent localhost.
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.DEPLOY_PUBLIC_ORIGIN || "";
const EMAIL_FROM = required("EMAIL_FROM");

// Helper to generate a basic plain-text version of our HTML emails for better deliverability.
function htmlToText(html: string): string {
  return html
    .replace(/\n+/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, ' ') // strip tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s{2,}/g, ' ') // collapse whitespace
    .trim();
}

// ---- Transport Strategy ----
// We now support three outbound methods in this priority order:
// 1. RESEND_API_KEY  -> Resend HTTPS API
// 2. SENDGRID_API_KEY -> SendGrid HTTPS API
// 3. Raw SMTP (Gmail or other) via Nodemailer (may be blocked on some hosts)
// If SMTP repeatedly times out, configure one of the API providers above; they use port 443
// and are far less likely to be firewalled.

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || '').toLowerCase(); // optional explicit selection

// ---- SMTP Transport (with fallback + timeouts + debug) ----
// Made OPTIONAL: If you only configure RESEND_API_KEY or SENDGRID_API_KEY, we won't require SMTP_* vars.
const SMTP_HOST = process.env.SMTP_HOST;
const PRIMARY_PORT = (() => { const p = Number(process.env.SMTP_PORT); return Number.isFinite(p) ? p : 587; })();
const PRIMARY_SECURE = String(process.env.SMTP_SECURE || "false") === "true"; // implicit TLS when true
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

function makeTransport(port: number, secure: boolean) {
  const options: nodemailer.TransportOptions = {
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: false,
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") === "true"
    },
    logger: process.env.SMTP_DEBUG === 'true',
    debug: process.env.SMTP_DEBUG === 'true'
  } as any; // cast to any to avoid over-narrowed union issues if type defs change
  return nodemailer.createTransport(options as any);
}

let transporter: nodemailer.Transporter | null = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  try {
    transporter = makeTransport(PRIMARY_PORT, PRIMARY_SECURE);
  } catch (e) {
    console.error('[email] Failed to initialize SMTP transporter:', e);
  }
} else {
  console.log('[email] SMTP credentials not fully provided; will rely on API provider if available.');
}

async function sendMailWithFallback(to: string, subject: string, html: string) {
  try {
    if (!transporter) throw new Error('SMTP transporter unavailable (missing SMTP_* env vars)');
    return await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
  } catch (err: any) {
    const code = err?.code || err?.errno || err?.responseCode;
    const isTimeout = code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(String(err?.message || ''));
    const isConn = code === 'ECONNECTION' || code === 'ECONNREFUSED';
    // Attempt fallback only if using Gmail + implicit TLS (465) originally
    if (transporter && (isTimeout || isConn) && SMTP_HOST === 'smtp.gmail.com' && PRIMARY_PORT === 465) {
      console.warn('[email] Primary SMTP connection failed (port 465). Trying STARTTLS fallback on 587...');
      try {
        transporter = makeTransport(587, false);
        return await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
      } catch (e2) {
        console.error('[email] Fallback SMTP (587) also failed:', e2);
        throw e2;
      }
    }
    console.error('[email] SMTP send failed (no fallback attempted):', err);
    throw err;
  }
}

// Optionally verify connection at startup
// transporter.verify().then(() => console.log("SMTP ready")).catch(err => console.error("SMTP verify failed:", err));

// ---- API Provider helpers ----

function httpsJson(url: string, method: string, headers: Record<string,string>, bodyObj: any): Promise<{status: number; body: string;}> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('HTTPS request timeout')); });
    req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

async function sendViaResend(to: string, subject: string, html: string) {
  const resp = await httpsJson('https://api.resend.com/emails', 'POST', {
    Authorization: `Bearer ${RESEND_API_KEY}`
  }, { from: EMAIL_FROM, to: [to], subject, html, text: htmlToText(html) });
  if (resp.status >= 200 && resp.status < 300) return true;
  throw new Error(`Resend API failed (${resp.status}): ${resp.body.slice(0,200)}`);
}

async function sendViaSendGrid(to: string, subject: string, html: string) {
  const resp = await httpsJson('https://api.sendgrid.com/v3/mail/send', 'POST', {
    Authorization: `Bearer ${SENDGRID_API_KEY}`
  }, {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: EMAIL_FROM.replace(/.*<([^>]+)>.*/, '$1') },
    subject,
    content: [
      { type: 'text/plain', value: htmlToText(html) },
      { type: 'text/html', value: html }
    ]
  });
  if (resp.status === 202) return true;
  throw new Error(`SendGrid API failed (${resp.status}): ${resp.body.slice(0,200)}`);
}

async function sendMail(to: string, subject: string, html: string) {
  // Provider selection: explicit EMAIL_PROVIDER overrides detection
  if (RESEND_API_KEY) {
    console.log('[email] Using Resend provider');
  } else if (SENDGRID_API_KEY) {
    console.log('[email] Using SendGrid provider');
  } else if (!transporter) {
    console.warn('[email] No email provider (Resend/SendGrid) or SMTP credentials configured. Emails will fail.');
  }
  // Warn if using a gmail.com sender with an API provider (deliverability risk)
  const senderDomainMatch = EMAIL_FROM.match(/<([^>]+)>/);
  const senderAddress = (senderDomainMatch ? senderDomainMatch[1] : EMAIL_FROM).toLowerCase();
  if ((RESEND_API_KEY || SENDGRID_API_KEY) && senderAddress.endsWith('@gmail.com')) {
    console.warn('[email] WARNING: Using a gmail.com sender with an API provider; verify a custom domain for better deliverability.');
  }
  try {
    if (EMAIL_PROVIDER === 'resend' || (RESEND_API_KEY && !EMAIL_PROVIDER && !SENDGRID_API_KEY)) {
      return await sendViaResend(to, subject, html);
    }
    if (EMAIL_PROVIDER === 'sendgrid' || (SENDGRID_API_KEY && !EMAIL_PROVIDER)) {
      return await sendViaSendGrid(to, subject, html);
    }
  } catch (apiErr) {
    const msg = String((apiErr as any)?.message || apiErr);
    // Resend test-mode restriction message
    if (msg.includes('You can only send testing emails')) {
      console.warn('[email] Resend test-mode restriction: domain not verified; email to non-owner blocked. Skipping SMTP fallback.');
      const err = new Error('EMAIL_DOMAIN_UNVERIFIED');
      (err as any).code = 'EMAIL_DOMAIN_UNVERIFIED';
      (err as any).original = apiErr;
      throw err;
    }
    console.error('[email] API provider failed, attempting SMTP fallback:', apiErr);
  }
  return sendMailWithFallback(to, subject, html);
}

// ---- Public API (unchanged signatures) ----

export const sendVerificationEmail = async (
  email: string,
  token: string,
  username: string
) => {
  const safeName = escapeHtml(username || "User");
  const link = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
      <!-- Header -->
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);">
        <div style="background: rgba(251, 191, 36, 0.1); border: 2px solid #fbbf24; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
          🎓
        </div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Ilaw ng Bayan</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Learning Institute</p>
      </div>
      
      <!-- Content -->
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Welcome, ${safeName}! ✨</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
          Thank you for joining Ilaw ng Bayan Learning Institute! We're excited to have you as part of our educational community.
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
          Please verify your email address to complete your registration and start your learning journey:
        </p>
        
        <!-- Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" 
             style="display: inline-block; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #1e3a8a; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(251, 191, 36, 0.3); transition: all 0.3s ease;">
            ✅ Verify Email Address
          </a>
        </div>
        
        <div style="background: #fef3c7; border-left: 4px solid #fbbf24; padding: 15px; margin: 25px 0; border-radius: 8px;">
          <p style="margin: 0; color: #92400e; font-size: 14px;">
            ⏰ <strong>Important:</strong> This verification link will expire in ${VERIFY_TTL_HOURS} hours for security purposes.
          </p>
        </div>
        
        <p style="font-size: 14px; color: #6b7280; margin: 25px 0 0; line-height: 1.5;">
          If you didn't create this account, please ignore this email or contact our support team.
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">
          "Liwanag, Kaalaman, Paglilingkod"
        </p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">
          Light • Knowledge • Service
        </p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Verify your Ilaw ng Bayan Learning Institute account", html);
    console.log("Verification email queued (recipient hidden for privacy)");
  } catch (error: any) {
    console.error("SMTP send error (verification):", error?.message ?? String(error));
    throw new Error("Failed to send verification email");
  }
};

export const sendPasswordResetEmail = async (
  email: string,
  token: string,
  username: string
) => {
  const safeName = escapeHtml(username || "User");
  const link = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
      <!-- Header -->
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
        <div style="background: rgba(220, 53, 69, 0.2); border: 2px solid #dc3545; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 30px;">
          🔐
        </div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Password Reset</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Ilaw ng Bayan Learning Institute</p>
      </div>
      
      <!-- Content -->
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Hello ${safeName},</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
          We received a request to reset your password. If you made this request, click the button below to set a new password:
        </p>
        
        <!-- Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}"
             style="display: inline-block; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3);">
            🔄 Reset Password
          </a>
        </div>
        
        <div style="background: #fee2e2; border-left: 4px solid #dc3545; padding: 15px; margin: 25px 0; border-radius: 8px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">
            ⚠️ <strong>Security Notice:</strong> This link will expire in ${RESET_TTL_MIN} minutes. If you didn't request this reset, please ignore this email.
          </p>
        </div>
      </div>
      
      <!-- Footer -->
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">
          "Liwanag, Kaalaman, Paglilingkod"
        </p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">
          Light • Knowledge • Service
        </p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Reset your Ilaw ng Bayan Learning Institute password", html);
    console.log("Password reset email queued (recipient hidden for privacy)");
  } catch (error: any) {
    console.error("SMTP send error (password reset):", error?.message ?? String(error));
    throw new Error("Failed to send password reset email");
  }
};

export const sendWelcomeEmail = async (
  email: string,
  username: string,
  role: string
) => {
  const safeName = escapeHtml(username || "User");
  const safeRole = escapeHtml(role || "student");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
      <!-- Header -->
      <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white;">
        <div style="background: rgba(34, 197, 94, 0.2); border: 2px solid #22c55e; border-radius: 50%; width: 80px; height: 80px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 30px;">
          🎓
        </div>
        <h1 style="color: #fbbf24; margin: 0; font-size: 28px; font-weight: bold;">Welcome Aboard!</h1>
        <p style="color: #fbbf24; margin: 5px 0 0; font-size: 16px;">Ilaw ng Bayan Learning Institute</p>
      </div>
      
      <!-- Content -->
      <div style="background: white; padding: 40px 30px; color: #374151;">
        <h2 style="color: #1e3a8a; margin: 0 0 20px; font-size: 24px;">Congratulations, ${safeName}! 🌟</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
          Your <strong>${safeRole}</strong> account has been successfully verified! You're now part of the Ilaw ng Bayan Learning Institute community.
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
          Get ready to explore our interactive educational content and begin your learning journey!
        </p>
        
        <!-- Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" 
             style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3);">
            🚀 Start Learning Now
          </a>
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
        
        <p style="font-size: 16px; color: #374151; margin: 25px 0 0; text-align: center;">
          Happy learning! 📚✨
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background: #1e3a8a; padding: 30px; text-align: center; color: #fbbf24;">
        <p style="margin: 0 0 10px; font-style: italic; font-size: 16px;">
          "Liwanag, Kaalaman, Paglilingkod"
        </p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">
          Light • Knowledge • Service
        </p>
      </div>
    </div>
  `;

  try {
    await sendMail(email, "Welcome to Ilaw ng Bayan Learning Institute! 🎉", html);
    console.log("Welcome email queued (recipient hidden for privacy)");
  } catch (error: any) {
    console.error("SMTP send error (welcome):", error?.message ?? String(error));
    throw new Error("Failed to send welcome email");
  }
};