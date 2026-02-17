// ✅ COPY-PASTE FINAL COMPLETO
// src/services/shopCustomer.service.js

const db = require("../models"); // sequelize

async function getCustomerById(id) {
  const [rows] = await db.sequelize.query(
    `SELECT * FROM ecom_customers WHERE id = :id LIMIT 1`,
    { replacements: { id } }
  );
  return rows?.[0] || null;
}

async function findCustomerByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;

  const [rows] = await db.sequelize.query(
    `SELECT * FROM ecom_customers WHERE email = :email LIMIT 1`,
    { replacements: { email: e } }
  );
  return rows?.[0] || null;
}

async function findOrCreateCustomerByEmail({ email, first_name = null, last_name = null, phone = null }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("EMAIL_REQUIRED");

  const existing = await findCustomerByEmail(e);
  if (existing) {
    const needs =
      (first_name && !existing.first_name) ||
      (last_name && !existing.last_name) ||
      (phone && !existing.phone);

    if (needs) {
      await db.sequelize.query(
        `UPDATE ecom_customers
         SET first_name = COALESCE(first_name, :first_name),
             last_name  = COALESCE(last_name, :last_name),
             phone      = COALESCE(phone, :phone),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = :id`,
        { replacements: { first_name, last_name, phone, id: existing.id } }
      );
      return await getCustomerById(existing.id);
    }

    return existing;
  }

  await db.sequelize.query(
    `INSERT INTO ecom_customers (email, first_name, last_name, phone, created_at, updated_at)
     VALUES (:email, :first_name, :last_name, :phone, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    { replacements: { email: e, first_name, last_name, phone } }
  );

  return await findCustomerByEmail(e);
}

module.exports = {
  getCustomerById,
  findCustomerByEmail,
  findOrCreateCustomerByEmail,
};
