// ✅ COPY-PASTE FINAL COMPLETO
// src/services/shopSession.service.js

const crypto = require("crypto");
const db = require("../models");
const { getCustomerById } = require("./shopCustomer.service");

const COOKIE = process.env.SHOP_SESSION_COOKIE || "pos360_shop_session";
const DAYS = Number(process.env.SHOP_SESSION_DAYS || 30);

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function setShopSessionCookie(res, token) {
  const isProd = String(process.env.NODE_ENV) === "production";
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearShopSessionCookie(res) {
  const isProd = String(process.env.NODE_ENV) === "production";
  res.cookie(COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function createShopSessionForCustomer(req, customerId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null;

  const ua = req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 255) : null;

  await db.sequelize.query(
    `INSERT INTO ecom_customer_sessions (customer_id, token_hash, ip, user_agent, expires_at, created_at)
     VALUES (:customer_id, :token_hash, :ip, :ua, :expires_at, CURRENT_TIMESTAMP)`,
    {
      replacements: {
        customer_id: customerId,
        token_hash: tokenHash,
        ip,
        ua,
        expires_at: expiresAt,
      },
    }
  );

  return token;
}

async function getShopCustomerFromRequest(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;

  const tokenHash = sha256(token);

  const [rows] = await db.sequelize.query(
    `SELECT customer_id
     FROM ecom_customer_sessions
     WHERE token_hash = :token_hash
       AND expires_at > NOW()
     LIMIT 1`,
    { replacements: { token_hash: tokenHash } }
  );

  const sess = rows?.[0];
  if (!sess?.customer_id) return null;

  return await getCustomerById(sess.customer_id);
}

module.exports = {
  setShopSessionCookie,
  clearShopSessionCookie,
  createShopSessionForCustomer,
  getShopCustomerFromRequest,
};
