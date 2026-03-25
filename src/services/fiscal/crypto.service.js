const crypto = require("crypto");

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = String(process.env.FISCAL_SECRET_KEY || "").trim();

  if (!raw) {
    throw new Error("Missing required env var: FISCAL_SECRET_KEY");
  }

  // aceptamos 32 bytes hex o cualquier string; si no es hex la derivamos
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(text) {
  if (text === undefined || text === null || text === "") return null;

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(payload) {
  if (!payload) return null;

  const key = getKey();
  const [ivB64, tagB64, dataB64] = String(payload).split(".");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

module.exports = {
  encrypt,
  decrypt,
};