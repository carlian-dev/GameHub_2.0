// Invitation service — admin invitation lifecycle.
// migration.md §13.2: token 32 bytes → 64 hex, TTL 24h, single use,
// re-invite deletes prior unused invites for that email, mail failure rolls back.
import crypto from "node:crypto";

const INVITE_TTL_SECONDS = 86400; // 24 hours

export function invitationService({ invitationModel, db, mailer }) {
  const activityLogs = db.collection("activityLogs");
  const invitationsColl = db.collection("invitations");

  return {
    async check(token) {
      if (!token) {
        const err = new Error("invitation invalid");
        err.status = 404;
        throw err;
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const invitation = await invitationModel.findByTokenHashAny(tokenHash);
      if (!invitation) {
        const err = new Error("invitation invalid");
        err.status = 404;
        throw err;
      }
      const now = new Date();
      const expired = invitation.expiresAt && now > invitation.expiresAt;
      if (invitation.used) {
        const err = new Error("invitation used");
        err.status = 410;
        throw err;
      }
      if (expired) {
        const err = new Error("invitation expired");
        err.status = 410;
        throw err;
      }
      return { valid: true, email: invitation.email };
    },

    async create({ email, actorId, frontendUrl, mailerDryRun = false }) {
      const lowerEmail = String(email).toLowerCase().trim();
      if (!lowerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) {
        const err = new Error("valid email is required");
        err.status = 422;
        throw err;
      }
      if (!frontendUrl) {
        const err = new Error(
          "FRONTEND_URL is not set, cannot build the invitation link"
        );
        err.status = 500;
        throw err;
      }

      // Resend replaces: one live invitation per email at a time.
      await invitationsColl.deleteMany({ email: lowerEmail, used: false });

      const token = crypto.randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_SECONDS * 1000);

      const insertedId = await invitationModel.create({
        email: lowerEmail,
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        expiresAt,
        createdBy: actorId,
        createdAt: now,
      });

      const base = frontendUrl.replace(/\/$/, "");
      const link = `${base}/src/function/auth/register.html?token=${token}`;

      try {
        if (mailerDryRun) {
          // Do not send real email in tests.
          // eslint-disable-next-line no-console
          console.log(`[invite] DRY-RUN invite mail to ${lowerEmail}: ${link}`);
        } else if (mailer && mailer.sendInvite) {
          await mailer.sendInvite(lowerEmail, link);
        } else {
          const err = new Error(
            "mail sending is not configured (set MAIL_USER/MAIL_PASS)"
          );
          err.status = 500;
          throw err;
        }
      } catch (err) {
        // Don't leave a phantom pending invite that was never mailed.
        await invitationsColl.deleteOne({ _id: insertedId });
        throw err;
      }

      // Invite IS the approval: log with inviter as actor.
      await activityLogs.insertOne({
        actorId,
        action: "approve_cashier",
        target: String(insertedId),
        at: now,
      });

      return {
        ok: true,
        id: String(insertedId),
        email: lowerEmail,
        link,
        message: "invitation sent (valid 24 hours, single use)",
      };
    },

    async list() {
      const docs = await invitationModel.list();
      const now = new Date();
      return {
        ok: true,
        invitations: docs.map((doc) => {
          const used = !!doc.used;
          const expired = doc.expiresAt && now > doc.expiresAt;
          const status = used ? "used" : expired ? "expired" : "pending";
          return {
            id: String(doc._id),
            email: doc.email ?? "",
            status,
            createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
          };
        }),
      };
    },

    async revoke(id) {
      const doc = await invitationModel.findById(id);
      if (!doc) {
        const err = new Error("invitation not found");
        err.status = 404;
        throw err;
      }
      await invitationModel.revoke(id);
      return { ok: true, id: String(doc._id), status: "revoked" };
    },
  };
}
