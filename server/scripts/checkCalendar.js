// Google Calendar diagnostic — verifies the three GOOGLE_CALENDAR_* values in
// one shot: service-account JWT, Calendar API enablement, and calendar sharing.
// Creates a throwaway event and deletes it again (no residue). Never prints the
// private key. Run from server/: `npm run check:calendar`.
import { env } from "../src/config/env.js";
import { googleCalendarService } from "../src/services/googleCalendar.service.js";

const MISSING = [
  ["GOOGLE_CALENDAR_ID", env.GOOGLE_CALENDAR_ID],
  ["GOOGLE_CALENDAR_CLIENT_EMAIL", env.GOOGLE_CALENDAR_CLIENT_EMAIL],
  ["GOOGLE_CALENDAR_PRIVATE_KEY", env.GOOGLE_CALENDAR_PRIVATE_KEY],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

async function main() {
  if (MISSING.length) {
    console.error(`[checkCalendar] disabled — missing ${MISSING.join(", ")}`);
    process.exit(1);
  }

  const svc = googleCalendarService({
    calendarId: env.GOOGLE_CALENDAR_ID,
    clientEmail: env.GOOGLE_CALENDAR_CLIENT_EMAIL,
    privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
  });

  console.log(`[checkCalendar] calendar: ${env.GOOGLE_CALENDAR_ID}`);
  console.log(`[checkCalendar] service account: ${env.GOOGLE_CALENDAR_CLIENT_EMAIL}`);

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  let eventId = "";
  try {
    eventId = await svc.createReservationEvent({
      ref: "DIAG-CHECK",
      tableName: "Diagnostic",
      customerName: "Calendar check",
      contactNumber: "—",
      durationMinutes: 60,
      startTime: start,
      endTime: end,
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`[checkCalendar] create failed: ${message}`);

    if (err && err.status === 403 && /has not been used in project/i.test(message)) {
      const url = message.match(/https:\/\/console\.developers\.google\.com\/[^\s]+/);
      console.error("[checkCalendar] Fix: enable \"Google Calendar API\" in Google Cloud Console.");
      if (url) console.error(`[checkCalendar] ${url[0]}`);
      console.error("[checkCalendar] After enabling, wait a few minutes and re-run this check.");
    } else if (err && err.status === 404) {
      console.error(
        `[checkCalendar] Fix: share the calendar with ${env.GOOGLE_CALENDAR_CLIENT_EMAIL} ` +
          'and grant "Make changes to events".'
      );
    } else if (err && err.status === 401) {
      console.error("[checkCalendar] Fix: check GOOGLE_CALENDAR_CLIENT_EMAIL / _PRIVATE_KEY match the same service-account key.");
    }
    process.exit(1);
  }

  if (!eventId) {
    console.error("[checkCalendar] create failed: Google returned no event id");
    process.exit(1);
  }

  console.log(`[checkCalendar] event created: ${eventId}`);
  try {
    await svc.deleteReservationEvent(eventId);
    console.log("[checkCalendar] test event deleted");
  } catch (err) {
    console.warn(
      `[checkCalendar] event ${eventId} could not be deleted (delete manually): ` +
        (err && err.message ? err.message : err)
    );
  }

  console.log("[checkCalendar] OK — calendar sync is configured and writable");
}

main().catch((err) => {
  console.error("[checkCalendar] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
