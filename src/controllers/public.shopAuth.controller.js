// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/public.shopAuth.controller.js

const { OAuth2Client } = require("google-auth-library");
const db = require("../models");
const {
  setShopSessionCookie,
  clearShopSessionCookie,
  createShopSessionForCustomer,
  getShopCustomerFromRequest,
} = require("../services/shopSession.service");
const { findOrCreateCustomerByEmail } = require("../services/shopCustomer.service");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function safeCustomer(c) {
  if (!c) return null;
  return {
    id: c.id,
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    phone: c.phone,
  };
}

async function me(req, res) {
  const customer = await getShopCustomerFromRequest(req);
  return res.json({ customer: safeCustomer(customer) });
}

async function logout(req, res) {
  clearShopSessionCookie(res);
  return res.json({ ok: true });
}

// POST /api/v1/public/auth/google  body: { credential: "<google id_token>" }
async function loginGoogleIdToken(req, res) {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: "MISSING_CREDENTIAL" });
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: "GOOGLE_CLIENT_ID_NOT_SET" });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload() || {};
    const email = payload.email;
    const sub = payload.sub;

    if (!email || !sub) return res.status(401).json({ error: "GOOGLE_INVALID" });

    const customer = await findOrCreateCustomerByEmail({
      email,
      first_name: payload.given_name || null,
      last_name: payload.family_name || null,
    });

    // Upsert identity
    await db.sequelize.query(
      `INSERT INTO ecom_customer_identities (customer_id, provider, provider_user_id, email, profile_json, created_at)
       VALUES (:customer_id, 'GOOGLE', :provider_user_id, :email, :profile_json, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         customer_id = VALUES(customer_id),
         email = VALUES(email),
         profile_json = VALUES(profile_json)`,
      {
        replacements: {
          customer_id: customer.id,
          provider_user_id: String(sub),
          email: String(email).toLowerCase(),
          profile_json: JSON.stringify(payload),
        },
      }
    );

    const sessionToken = await createShopSessionForCustomer(req, customer.id);
    setShopSessionCookie(res, sessionToken);

    return res.json({ customer: safeCustomer(customer) });
  } catch (e) {
    console.error("loginGoogleIdToken:", e?.message || e);
    return res.status(401).json({ error: "GOOGLE_AUTH_FAILED" });
  }
}

module.exports = {
  me,
  logout,
  loginGoogleIdToken,
};
