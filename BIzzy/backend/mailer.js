// Business OS v3 — SaaS Stage 2: tiny mailer for OTP / account emails.
// Config comes ONLY from the environment (see .env.example):
//   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
// (SMTP_* is accepted as an alias prefix for the same five values.)
//
// HONESTY RULE (founder's): when no mail config exists, mail is NOT sent.
// The message (with the OTP) is written to the server console log ONLY —
// clearly marked [DEV-MAIL] — and sendMail reports mail_configured:false.
// Callers surface that flag in API responses; the OTP itself is NEVER put
// in an API response, configured or not.
function envFirst(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function mailConfig() {
  const host = envFirst('MAIL_HOST', 'SMTP_HOST');
  const user = envFirst('MAIL_USER', 'SMTP_USER');
  const pass = envFirst('MAIL_PASS', 'SMTP_PASS');
  const from = envFirst('MAIL_FROM', 'SMTP_FROM') || user;
  const port = Number(envFirst('MAIL_PORT', 'SMTP_PORT') || 587);
  return { host, user, pass, from, port, configured: !!(host && user && pass && from) };
}

let transporter = null;
function getTransporter(cfg) {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // 465 = implicit TLS; 587/25 = STARTTLS upgrade
    auth: { user: cfg.user, pass: cfg.pass }
  });
  return transporter;
}

// Returns { sent, mail_configured }. Never throws for a config problem —
// a mail outage must not break signup; it just means no live mail.
async function sendMail(to, subject, text) {
  const cfg = mailConfig();
  if (!cfg.configured) {
    console.log(`[DEV-MAIL] (mail NOT configured — nothing was emailed) To: ${to} | Subject: ${subject} | ${text}`);
    return { sent: false, mail_configured: false };
  }
  try {
    await getTransporter(cfg).sendMail({ from: cfg.from, to, subject, text });
    return { sent: true, mail_configured: true };
  } catch (e) {
    console.error('mail send failed:', e && e.message ? e.message : e);
    return { sent: false, mail_configured: true };
  }
}

module.exports = { sendMail, mailConfig };
