// Super-admin authenticator app: multiple devices + step-up verification.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { twoFactorService } from "../../src/services/twoFactor.service.js";
import { createSecretBox } from "../../src/utils/secretBox.js";
import { base32Encode, generateTotp } from "../../src/utils/totp.js";

const KEY = "c".repeat(64);
const SECRET = base32Encode(Buffer.from("12345678901234567890"));
const SECOND_SECRET = base32Encode(Buffer.from("abcdefghij0123456789"));
const PENDING_SECRET = base32Encode(Buffer.from("klmnopqrst0123456789"));
const box = createSecretBox(KEY);

function device(id, label, secret) {
  return {
    id,
    label,
    secretEnc: box.encrypt(secret),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastUsedCounter: -1,
    lastUsedAt: null,
  };
}

function legacyUser(extra = {}) {
  return {
    _id: "super-1",
    role: "super_admin",
    status: "active",
    twoFactor: {
      enabled: true,
      secretEnc: box.encrypt(SECRET),
      enabledAt: new Date("2026-01-01T00:00:00Z"),
      lastUsedCounter: -1,
      lastUsedAt: null,
    },
    ...extra,
  };
}

function multiDeviceUser() {
  return {
    _id: "super-1",
    role: "super_admin",
    status: "active",
    twoFactor: {
      enabled: true,
      devices: [
        device("dev-1", "Phone", SECRET),
        device("dev-2", "Tablet", SECOND_SECRET),
      ],
      enabledAt: new Date("2026-01-01T00:00:00Z"),
      lastUsedAt: null,
    },
  };
}

function serviceFor({ user, modifiedCount = 1 } = {}) {
  const updates = [];
  const inserted = [];
  const service = twoFactorService({
    userModel: { findById: async () => user },
    db: {
      collection: (name) =>
        name === "users"
          ? {
              updateOne: async (filter, update) => {
                updates.push({ filter, update });
                const count =
                  typeof modifiedCount === "function"
                    ? modifiedCount(filter, update)
                    : modifiedCount;
                return { modifiedCount: count };
              },
            }
          : {
              insertOne: async (doc) => {
                inserted.push(doc);
              },
            },
    },
    encryptionKey: KEY,
  });
  return { service, updates, inserted };
}

describe("super-admin two-factor step-up", () => {
  it("accepts a current authenticator code from the legacy single-device shape", async () => {
    const { service } = serviceFor({ user: legacyUser() });
    assert.equal(await service.verifyStepUp("super-1", generateTotp(SECRET)), true);
  });

  it("rejects a malformed code", async () => {
    const { service } = serviceFor({ user: legacyUser() });
    await assert.rejects(
      () => service.verifyStepUp("super-1", "abcdef"),
      (err) => err.status === 422 && /invalid authenticator code/i.test(err.message)
    );
  });

  it("rejects a stale code that the database guard refuses", async () => {
    const { service } = serviceFor({ user: legacyUser(), modifiedCount: 0 });
    await assert.rejects(
      () => service.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 409 && /too old/i.test(err.message)
    );
  });

  it("rejects when no authenticator app is paired", async () => {
    const { service } = serviceFor({ user: legacyUser({ twoFactor: null }) });
    await assert.rejects(
      () => service.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 409 && /not enabled/i.test(err.message)
    );
  });

  it("requires the current code before adding another device", async () => {
    const { service } = serviceFor({ user: legacyUser() });
    const currentCode = generateTotp(SECRET);
    const wrongCode = currentCode === "000000" ? "000001" : "000000";
    await assert.rejects(
      () => service.beginEnrollment("super-1", ""),
      (err) => err.status === 422 && /current 6-digit code/i.test(err.message)
    );
    await assert.rejects(
      () => service.beginEnrollment("super-1", wrongCode),
      (err) => err.status === 422 && /invalid authenticator code/i.test(err.message)
    );
    const setup = await service.beginEnrollment("super-1", currentCode);
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
  });

  it("lets a first-time pairing start without a code", async () => {
    const { service } = serviceFor({
      user: { ...legacyUser({ twoFactor: null }) },
    });
    const setup = await service.beginEnrollment("super-1", "");
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.match(setup.qrDataUrl, /^data:image\/png;base64,/);
    assert.notEqual(setup.secret, undefined);
  });

  it("rejects an inactive account", async () => {
    const { service } = serviceFor({ user: legacyUser({ status: "archived" }) });
    await assert.rejects(
      () => service.verifyStepUp("super-1", generateTotp(SECRET)),
      (err) => err.status === 403
    );
  });
});

describe("super-admin multiple authenticator devices", () => {
  it("accepts a code from the second paired device and updates that device", async () => {
    const { service, updates } = serviceFor({ user: multiDeviceUser() });
    assert.equal(
      await service.verifyStepUp("super-1", generateTotp(SECOND_SECRET)),
      true
    );
    const update = updates.find(({ filter }) => filter["twoFactor.devices"]);
    assert.ok(update, "expected a devices $elemMatch update");
    assert.equal(update.filter["twoFactor.devices"].$elemMatch.id, "dev-2");
    assert.ok(update.update.$set["twoFactor.devices.$.lastUsedAt"] instanceof Date);
  });

  it("still accepts a code from the first device after a second is paired", async () => {
    const { service } = serviceFor({ user: multiDeviceUser() });
    assert.equal(await service.verifyStepUp("super-1", generateTotp(SECRET)), true);
  });

  it("exposes device labels but never secrets in status", async () => {
    const { service } = serviceFor({ user: multiDeviceUser() });
    const status = await service.status("super-1");
    assert.equal(status.enabled, true);
    assert.equal(status.deviceLimit, 5);
    assert.deepEqual(status.devices.map((entry) => entry.label), ["Phone", "Tablet"]);
    for (const entry of status.devices) {
      assert.equal("secretEnc" in entry, false);
      assert.equal("secret" in entry, false);
    }
  });

  it("adds a device without removing the existing one", async () => {
    const pending = {
      id: "setup-1",
      secretEnc: box.encrypt(PENDING_SECRET),
      label: "Backup phone",
      createdAt: new Date(),
    };
    const user = legacyUser({ twoFactorPending: pending });
    const { service, updates } = serviceFor({ user });
    const status = await service.completeEnrollment(
      "super-1",
      generateTotp(PENDING_SECRET)
    );
    assert.deepEqual(status.devices.map((entry) => entry.label), [
      "Original device",
      "Backup phone",
    ]);
    const written = updates[0].update.$set.twoFactor;
    assert.equal(written.devices.length, 2);
    assert.equal(written.devices[0].id, "legacy-primary");
    assert.equal("secretEnc" in written, false);
  });

  it("caps the number of paired devices", async () => {
    const user = multiDeviceUser();
    user.twoFactor.devices = [
      device("dev-1", "One", SECRET),
      device("dev-2", "Two", SECOND_SECRET),
      device("dev-3", "Three", PENDING_SECRET),
      device("dev-4", "Four", SECRET),
      device("dev-5", "Five", SECOND_SECRET),
    ];
    const { service } = serviceFor({ user });
    await assert.rejects(
      () => service.beginEnrollment("super-1", generateTotp(SECRET)),
      (err) => err.status === 409 && /up to 5/i.test(err.message)
    );
  });

  it("removes one device with a code from another and keeps the rest", async () => {
    const { service, updates, inserted } = serviceFor({ user: multiDeviceUser() });
    await service.removeDevice("super-1", "dev-1", generateTotp(SECOND_SECRET));
    const pull = updates.find(({ update }) => update.$pull);
    assert.ok(pull, "expected a $pull update");
    assert.deepEqual(pull.update.$pull["twoFactor.devices"], { id: "dev-1" });
    assert.deepEqual(pull.filter["twoFactor.devices.1"], { $exists: true });
    assert.equal(inserted.at(-1).action, "two_factor_device_removed");
  });

  it("refuses to remove the last device", async () => {
    const user = legacyUser();
    const { service } = serviceFor({ user });
    await assert.rejects(
      () => service.removeDevice("super-1", "legacy-primary", generateTotp(SECRET)),
      (err) => err.status === 409 && /only paired device/i.test(err.message)
    );
  });

  it("runs the full pair → verify → remove → disable flow", async () => {
    const state = {
      user: {
        _id: "super-1",
        role: "super_admin",
        status: "active",
      },
    };
    const service = twoFactorService({
      userModel: { findById: async () => state.user },
      db: {
        collection: (name) =>
          name === "users"
            ? {
                updateOne: async (filter, update) => {
                  if (update.$set?.twoFactorPending) {
                    state.user = {
                      ...state.user,
                      twoFactorPending: update.$set.twoFactorPending,
                    };
                  }
                  if (update.$set?.twoFactor) {
                    const { twoFactor } = update.$set;
                    state.user = {
                      ...state.user,
                      twoFactor,
                      twoFactorPending: undefined,
                    };
                  }
                  if (update.$pull?.["twoFactor.devices"]) {
                    const { id } = update.$pull["twoFactor.devices"];
                    state.user = {
                      ...state.user,
                      twoFactor: {
                        ...state.user.twoFactor,
                        devices: state.user.twoFactor.devices.filter(
                          (entry) => entry.id !== id
                        ),
                      },
                    };
                  }
                  if (update.$unset?.twoFactor) {
                    state.user = {
                      ...state.user,
                      twoFactor: undefined,
                      twoFactorPending: undefined,
                    };
                  }
                  return { modifiedCount: 1 };
                },
              }
            : { insertOne: async () => {} },
      },
      encryptionKey: KEY,
    });

    // First device.
    const firstSetup = await service.beginEnrollment("super-1", "", "Phone");
    let status = await service.completeEnrollment(
      "super-1",
      generateTotp(firstSetup.secret)
    );
    assert.equal(status.devices.length, 1);

    // Second device, approved with the first device's code.
    const secondSetup = await service.beginEnrollment(
      "super-1",
      generateTotp(firstSetup.secret),
      "Tablet"
    );
    status = await service.completeEnrollment(
      "super-1",
      generateTotp(secondSetup.secret)
    );
    assert.equal(status.devices.length, 2);

    // Both devices still approve a credential change.
    assert.equal(
      await service.verifyStepUp("super-1", generateTotp(firstSetup.secret)),
      true
    );
    assert.equal(
      await service.verifyStepUp("super-1", generateTotp(secondSetup.secret)),
      true
    );

    // Remove the phone with a code from the tablet.
    const phoneId = status.devices.find((entry) => entry.label === "Phone").id;
    status = await service.removeDevice(
      "super-1",
      phoneId,
      generateTotp(secondSetup.secret)
    );
    assert.deepEqual(status.devices.map((entry) => entry.label), ["Tablet"]);

    // Turning 2FA off clears the remaining device.
    status = await service.disable("super-1", generateTotp(secondSetup.secret));
    assert.equal(status.enabled, false);
    assert.equal(status.devices.length, 0);
  });

  it("logs the first device as 2FA enabled and later ones as device added", async () => {
    const pending = {
      id: "setup-2",
      secretEnc: box.encrypt(PENDING_SECRET),
      label: "Phone",
      createdAt: new Date(),
    };
    const first = serviceFor({
      user: {
        ...legacyUser({ twoFactor: null }),
        twoFactorPending: pending,
      },
    });
    await first.service.completeEnrollment("super-1", generateTotp(PENDING_SECRET));
    assert.equal(first.inserted.at(-1).action, "two_factor_enabled");

    const second = serviceFor({
      user: legacyUser({
        twoFactorPending: { ...pending, id: "setup-3" },
      }),
    });
    await second.service.completeEnrollment(
      "super-1",
      generateTotp(PENDING_SECRET)
    );
    assert.equal(second.inserted.at(-1).action, "two_factor_device_added");
  });
});
