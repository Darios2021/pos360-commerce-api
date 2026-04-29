// src/services/shopCustomer.service.js
//
// Servicio de clientes del shop. La tabla `ecom_customers` se crea con SQL
// bootstrap en otra parte; las columnas profile_completed y password_hash se
// agregan vía src/migrations/runner.js al startup del servidor.

const bcrypt = require("bcryptjs");
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

/**
 * Encuentra o crea un cliente por email.
 * Importante: NUNCA toca `profile_completed` aquí; la única forma de marcarlo
 * en true es vía updateCustomerProfile (cuando el usuario completa el form).
 * Cuando crea uno nuevo, queda con profile_completed=0 (default DB).
 */
async function findOrCreateCustomerByEmail({ email, first_name = null, last_name = null, phone = null }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("EMAIL_REQUIRED");

  const existing = await findCustomerByEmail(e);
  if (existing) {
    // Solo rellenamos campos vacíos con los datos que llegan de Google,
    // sin pisar lo que el usuario ya haya cargado a mano.
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

/**
 * Actualiza nombre, apellido, teléfono y password del cliente, marcándolo
 * como profile_completed=1. Se invoca desde el endpoint del shop cuando el
 * cliente completa su perfil. Si `password` viene vacía, no la toca (para
 * permitir editar perfil sin cambiar password).
 *
 * Lanza Error con .code para que el controller mapee a HTTP status apropiado.
 */
async function updateCustomerProfile(customerId, { first_name, last_name, phone, password }) {
  const id = Number(customerId);
  if (!id) {
    const err = new Error("INVALID_CUSTOMER");
    err.code = "INVALID_CUSTOMER";
    throw err;
  }

  // Validaciones server-side defensivas (el frontend ya valida pero no nos fiamos).
  const fn = String(first_name || "").trim();
  const ln = String(last_name || "").trim();
  const ph = String(phone || "").replace(/[^\d+]/g, "");
  if (!fn || fn.length < 2)  throwBad("FIRST_NAME_REQUIRED");
  if (!ln || ln.length < 2)  throwBad("LAST_NAME_REQUIRED");
  if (!ph || ph.replace(/\D/g, "").length < 8) throwBad("PHONE_INVALID");

  let passwordHash = null;
  if (password !== undefined && password !== null && String(password).length > 0) {
    const pw = String(password);
    if (pw.length < 8) throwBad("PASSWORD_TOO_SHORT");
    if (!/[A-Z]/.test(pw)) throwBad("PASSWORD_NEEDS_UPPER");
    if (!/[0-9]/.test(pw)) throwBad("PASSWORD_NEEDS_DIGIT");
    passwordHash = await bcrypt.hash(pw, 10);
  }

  // Build UPDATE dinámico (password solo si vino).
  if (passwordHash) {
    await db.sequelize.query(
      `UPDATE ecom_customers
       SET first_name = :first_name,
           last_name  = :last_name,
           phone      = :phone,
           password_hash = :password_hash,
           profile_completed = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { replacements: { first_name: fn, last_name: ln, phone: ph, password_hash: passwordHash, id } }
    );
  } else {
    await db.sequelize.query(
      `UPDATE ecom_customers
       SET first_name = :first_name,
           last_name  = :last_name,
           phone      = :phone,
           profile_completed = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { replacements: { first_name: fn, last_name: ln, phone: ph, id } }
    );
  }

  return await getCustomerById(id);
}

function throwBad(code) {
  const e = new Error(code);
  e.code = code;
  e.status = 400;
  throw e;
}

module.exports = {
  getCustomerById,
  findCustomerByEmail,
  findOrCreateCustomerByEmail,
  updateCustomerProfile,
};
