// Transactional email (nodemailer). One Gmail sender for cashier invitations
// and reservation updates. Sending is skipped (and logged) when MAIL_DRY_RUN=1;
// callers decide whether a failed send is fatal.
import nodemailer from "nodemailer";

const ADDRESS = "Rooftop, Paz Building, San Isidro St, Malaybalay City, Bukidnon";
const HOURS = "Open daily · 8:00 AM – 10:00 PM";
const TIME_ZONE = "Asia/Manila";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function asDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(value) {
  const d = asDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function fmtTime(value) {
  const d = asDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function durationLabel(minutes) {
  const n = Number(minutes || 0);
  if (!n) return "—";
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  if (hours && rest) return `${hours} hr ${rest} min`;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${rest} min`;
}

/** Pure builder so the accepted-reservation email can be tested without SMTP. */
export function reservationAcceptedMail(reservation = {}) {
  const ref = reservation.ref || "—";
  const customerName = reservation.customerName || "there";
  const tableName = reservation.tableName || "your table";
  const date = fmtDate(reservation.startTime);
  const start = fmtTime(reservation.startTime);
  const end = fmtTime(reservation.endTime);
  const duration = durationLabel(reservation.durationMinutes);
  const contact = reservation.contactNumber || "—";

  const text = [
    `Hi ${customerName},`,
    "",
    `Good news — your GameHub reservation has been ACCEPTED.`,
    "",
    `Reference: ${ref}`,
    `Table: ${tableName}`,
    `Date: ${date}`,
    `Time: ${start} – ${end}`,
    `Duration: ${duration}`,
    `Contact: ${contact}`,
    "",
    "Please arrive about 10 minutes before your slot.",
    "",
    ADDRESS,
    HOURS,
  ].join("\n");

  const row = (label, value) =>
    `<tr><td style="padding:7px 0;color:#64748B;font-size:13px;">${esc(label)}</td>` +
    `<td style="padding:7px 0;color:#202522;font-size:13px;font-weight:600;text-align:right;">${esc(value)}</td></tr>`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:28px 14px;background:#F5F3ED;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#374151;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #E5E7EB;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#0B3D2E;padding:22px 26px;">
                <span style="display:block;color:#F5F3ED;font-size:18px;font-weight:700;letter-spacing:-0.02em;">GameHub</span>
                <span style="display:block;color:#D4AF37;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Billiard &amp; More</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px;">
                <p style="margin:0 0 14px;font-size:15px;">Hi ${esc(customerName)},</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
                  Good news — your reservation has been
                  <strong style="color:#145A42;letter-spacing:0.04em;">ACCEPTED</strong>.
                </p>
                <div style="background:#E7F6EE;border:1px solid rgba(20,90,66,0.22);border-radius:12px;padding:12px 16px;margin-bottom:20px;">
                  <span style="display:block;color:#64748B;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;">Reference</span>
                  <span style="display:block;color:#145A42;font-size:20px;font-weight:700;letter-spacing:0.04em;margin-top:3px;">${esc(ref)}</span>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${row("Table", tableName)}
                  ${row("Date", date)}
                  ${row("Time", `${start} – ${end}`)}
                  ${row("Duration", duration)}
                  ${row("Contact", contact)}
                </table>
                <p style="margin:20px 0 0;font-size:14px;line-height:1.6;">Please arrive about 10 minutes before your slot.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px;background:#F9F8F4;border-top:1px solid #E5E7EB;">
                <p style="margin:0;color:#64748B;font-size:12px;line-height:1.6;">${esc(ADDRESS)}<br />${esc(HOURS)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: String(reservation.customerEmail || "").trim(),
    subject: `Your GameHub reservation is ACCEPTED — ${ref}`,
    text,
    html,
  };
}

export function mailService({
  user = "",
  pass = "",
  from = "GameHub",
  dryRun = false,
} = {}) {
  const enabled = Boolean(user && pass);
  const fromName = String(from || "GameHub").replace(/["\r\n]/g, "");
  let transport = null;

  function getTransport() {
    if (!transport) {
      transport = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
        // A slow SMTP server must not hold the accept request open all day.
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 15000,
      });
    }
    return transport;
  }

  async function deliver(mail) {
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(`[mail] DRY-RUN "${mail.subject}" -> ${mail.to}`);
      // Simulate the happy path so local UI testing behaves like production.
      return true;
    }
    if (!enabled) {
      throw new Error("mail sending is not configured (set MAIL_USER/MAIL_PASS)");
    }
    await getTransport().sendMail({
      from: `"${fromName}" <${user}>`,
      ...mail,
    });
    return true;
  }

  return {
    enabled,
    sendInvite(email, link) {
      return deliver({
        to: email,
        subject: "Your GameHub cashier invitation",
        text: [
          "You have been invited to join GameHub as a cashier.",
          "",
          `Set up your account: ${link}`,
          "",
          "This link expires in 24 hours and can be used once.",
        ].join("\n"),
        html:
          `<p>You have been invited to join GameHub as a cashier.</p>` +
          `<p><a href="${esc(link)}">Set up your account</a></p>` +
          `<p style="color:#64748B;font-size:13px;">This link expires in 24 hours and can be used once.</p>`,
      });
    },
    sendReservationAccepted(reservation) {
      return deliver(reservationAcceptedMail(reservation));
    },
  };
}
