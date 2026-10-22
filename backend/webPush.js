const crypto = require("crypto");
const fetch = require("node-fetch");

const b64url = (value) => Buffer.from(value).toString("base64url");
const fromB64url = (value) => Buffer.from(value, "base64url");

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;

  const publicBytes = fromB64url(publicKey);
  const privateBytes = fromB64url(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("Invalid VAPID key format");
  }

  return { publicKey, publicBytes, privateKey: privateBytes, subject };
}

function isPushConfigured() {
  try {
    return Boolean(getVapidConfig());
  } catch {
    return false;
  }
}

function getVapidPublicKey() {
  const config = getVapidConfig();
  return config && config.publicKey;
}

function createVapidAuthorization(endpoint, config = getVapidConfig()) {
  if (!config) throw new Error("Web Push is not configured");
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.subject
  }));
  const signingInput = header + "." + claims;
  const publicKey = config.publicBytes;
  const privateKey = crypto.createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
      d: b64url(config.privateKey)
    }
  });
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  });
  return "vapid t=" + signingInput + "." + b64url(signature) + ", k=" + config.publicKey;
}

function encryptPayload(subscription, payload) {
  const endpoint = subscription && subscription.endpoint;
  const keys = subscription && subscription.keys;
  if (typeof endpoint !== "string" || !keys || !keys.p256dh || !keys.auth) {
    throw new Error("Invalid push subscription");
  }

  const clientPublicKey = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 4 || authSecret.length !== 16) {
    throw new Error("Invalid push subscription encryption keys");
  }

  const serverEcdh = crypto.createECDH("prime256v1");
  serverEcdh.generateKeys();
  const serverPublicKey = serverEcdh.getPublicKey();
  const sharedSecret = serverEcdh.computeSecret(clientPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    clientPublicKey,
    serverPublicKey
  ]);
  const inputKeyMaterial = Buffer.from(crypto.hkdfSync(
    "sha256", sharedSecret, authSecret, keyInfo, 32
  ));

  const salt = crypto.randomBytes(16);
  const contentEncryptionKey = Buffer.from(crypto.hkdfSync(
    "sha256", inputKeyMaterial, salt,
    Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16
  ));
  const nonce = Buffer.from(crypto.hkdfSync(
    "sha256", inputKeyMaterial, salt,
    Buffer.from("Content-Encoding: nonce\0", "utf8"), 12
  ));

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const header = Buffer.concat([
    salt, recordSize, Buffer.from([serverPublicKey.length]), serverPublicKey
  ]);

  const json = Buffer.from(JSON.stringify(payload), "utf8");
  if (json.length + 1 > 3990) throw new Error("Push notification payload is too large");
  const plaintext = Buffer.concat([json, Buffer.from([2])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext), cipher.final(), cipher.getAuthTag()
  ]);
  return Buffer.concat([header, ciphertext]);
}

async function sendWebPush(subscription, payload) {
  const config = getVapidConfig();
  if (!config) return { skipped: true };

  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  const body = encryptPayload(subscription, payload);
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: createVapidAuthorization(endpoint.toString(), config),
      TTL: "86400",
      Urgency: "normal",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "Content-Length": String(body.length)
    },
    body,
    timeout: 10000
  });

  if (response.status === 404 || response.status === 410) {
    const error = new Error("Push subscription has expired");
    error.statusCode = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Push service returned " + response.status);
    error.statusCode = response.status;
    throw error;
  }
  return { sent: true };
}

module.exports = { getVapidPublicKey, isPushConfigured, encryptPayload, sendWebPush };
