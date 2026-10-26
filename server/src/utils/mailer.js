// SMTP mailer for invitation emails (nodemailer). Mirrors the PHP
// invite_send_mail() settings so invites keep working after the cutover.
// Returns null when MAIL_USER/MAIL_PASS are absent — the invitation service
// then fails with the same 500 the PHP backend produced.
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const SUBJECT = "Your GameHub cashier invitation";

function inviteText(link) {
  return (
    "Hi there,\n\n" +
    "You have been invited to create a GameHub cashier account.\n" +
    "Open this link within 24 hours (single use):\n\n" +
    `${link}\n\n` +
    "If you did not expect this, ignore this mail.\n"
  );
}

export function createMailer() {
  if (!env.MAIL_USER || !env.MAIL_PASS) return null;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });

  return {
    /** Send the cashier invitation link. Throws a 502-mapped error on failure. */
    async sendInvite(toEmail, link) {
      try {
        await transporter.sendMail({
          from: `"${env.MAIL_FROM || "GameHub"}" <${env.MAIL_USER}>`,
          to: toEmail,
          subject: SUBJECT,
          text: inviteText(link),
        });
      } catch (err) {
        // Log the driver detail for the admin (never leaks to Frontend).
        // eslint-disable-next-line no-console
        console.error(`[gamehub] invite mail to ${toEmail} failed: ${err.message}`);
        const e = new Error(
          "could not send the invitation email — check MAIL_USER/MAIL_PASS app password, then try again"
        );
        e.status = 502;
        throw e;
      }
    },
  };
}
