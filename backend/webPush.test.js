const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { encryptPayload, getVapidPublicKey } = require("./webPush");

test("encryptPayload creates an aes128gcm record header and ciphertext", () => {
  const client = crypto.createECDH("prime256v1");
  client.generateKeys();
  const body = encryptPayload({
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: {
      p256dh: client.getPublicKey().toString("base64url"),
      auth: crypto.randomBytes(16).toString("base64url")
    }
  }, { title: "New expense", body: "Your share is ₹100" });

  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(body[20], 65);
  assert.ok(body.length > 86);
});

test("encryptPayload rejects malformed subscription keys", () => {
  assert.throws(() => encryptPayload({
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    keys: { p256dh: "bad", auth: "bad" }
  }, { title: "Test" }), /Invalid push subscription encryption keys/);
});

test("getVapidPublicKey returns null when Web Push is not configured", () => {
  const original = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT
  };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  try {
    assert.equal(getVapidPublicKey(), null);
  } finally {
    for (const [key, value] of Object.entries({
      VAPID_PUBLIC_KEY: original.publicKey,
      VAPID_PRIVATE_KEY: original.privateKey,
      VAPID_SUBJECT: original.subject
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
