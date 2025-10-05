import nodemailer from "nodemailer";

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const transporter = nodemailer.createTransport({
    host: required("SMTP_HOST"),
    port: (function(){ const p = Number(required("SMTP_PORT")); return Number.isFinite(p) ? p : 587 })(),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: required("SMTP_USER"),
      pass: required("SMTP_PASS"),
    },
  });

  await transporter.verify();
  console.log("SMTP connection OK ✅ (credentials not logged)");

  const info = await transporter.sendMail({
    from: required("EMAIL_FROM"),
    to: required("SMTP_TEST_TO") || required("SMTP_USER"),
    subject: "SMTP test ✔",
    text: "If you can read this, SMTP works.",
  });

  console.log("Test mail sent (messageId hidden for privacy)");
}

main().catch(err => {
  console.error("SMTP test failed:", err);
  process.exit(1);
});