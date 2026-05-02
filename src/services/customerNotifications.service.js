// src/services/customerNotifications.service.js
//
// Centro de notificaciones del cliente del shop. Persiste en
// customer_notifications. Permite:
//  - create({ customer_id, type, title, body, ref_type, ref_id, image_url, link })
//  - listForCustomer(customer_id, { limit, offset, only_unread, type })
//  - markRead(customer_id, notification_id)
//  - markAllRead(customer_id)
//  - unreadCount(customer_id)
//
// La tabla se crea idempotentemente la primera vez que se invoca
// cualquiera de estos métodos (lazy init).

const { sequelize } = require("../models");

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS customer_notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        customer_id BIGINT UNSIGNED NOT NULL,
        type VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body VARCHAR(1000) NULL,
        ref_type VARCHAR(64) NULL,
        ref_id BIGINT UNSIGNED NULL,
        image_url VARCHAR(512) NULL,
        link VARCHAR(512) NULL,
        read_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cn_customer_unread (customer_id, read_at, created_at),
        INDEX idx_cn_ref (ref_type, ref_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    tableReady = true;
  } catch (e) {
    console.warn("[customerNotifications] ensureTable falló:", e?.message);
  }
}

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toStr(v, max = 0) {
  const s = String(v ?? "").trim();
  return max > 0 ? s.slice(0, max) : s;
}

/**
 * Crea una notificación para un customer.
 * @returns {Promise<{id:number}|null>}
 */
async function create({
  customer_id,
  type,
  title,
  body = null,
  ref_type = null,
  ref_id = null,
  image_url = null,
  link = null,
}) {
  await ensureTable();
  const cid = toInt(customer_id, 0);
  const t = toStr(type, 64);
  const ti = toStr(title, 255);
  if (!cid || !t || !ti) return null;

  try {
    const [res] = await sequelize.query(
      `INSERT INTO customer_notifications
         (customer_id, type, title, body, ref_type, ref_id, image_url, link, created_at)
       VALUES
         (:customer_id, :type, :title, :body, :ref_type, :ref_id, :image_url, :link, CURRENT_TIMESTAMP)`,
      {
        replacements: {
          customer_id: cid,
          type: t,
          title: ti,
          body: body ? toStr(body, 1000) : null,
          ref_type: ref_type ? toStr(ref_type, 64) : null,
          ref_id: ref_id ? toInt(ref_id, 0) || null : null,
          image_url: image_url ? toStr(image_url, 512) : null,
          link: link ? toStr(link, 512) : null,
        },
      }
    );
    return { id: Number(res?.insertId) || null };
  } catch (e) {
    console.warn("[customerNotifications.create] falló:", e?.message);
    return null;
  }
}

async function listForCustomer(customer_id, { limit = 30, offset = 0, only_unread = false, type = null } = {}) {
  await ensureTable();
  const cid = toInt(customer_id, 0);
  if (!cid) return { rows: [], total: 0, unread: 0 };

  const lim = Math.min(100, Math.max(1, toInt(limit, 30)));
  const off = Math.max(0, toInt(offset, 0));

  const where = ["customer_id = :cid"];
  const repl = { cid, limit: lim, offset: off };
  if (only_unread) where.push("read_at IS NULL");
  if (type) {
    where.push("type = :type");
    repl.type = String(type);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await sequelize.query(
    `SELECT id, customer_id, type, title, body, ref_type, ref_id,
            image_url, link, read_at, created_at
       FROM customer_notifications
      WHERE ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT :limit OFFSET :offset`,
    { replacements: repl }
  );

  const [tot] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM customer_notifications WHERE ${whereSql}`,
    { replacements: repl }
  );

  const [un] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM customer_notifications
      WHERE customer_id = :cid AND read_at IS NULL`,
    { replacements: { cid } }
  );

  return {
    rows: rows || [],
    total: Number(tot?.[0]?.n || 0),
    unread: Number(un?.[0]?.n || 0),
  };
}

async function unreadCount(customer_id) {
  await ensureTable();
  const cid = toInt(customer_id, 0);
  if (!cid) return 0;
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM customer_notifications
      WHERE customer_id = :cid AND read_at IS NULL`,
    { replacements: { cid } }
  );
  return Number(rows?.[0]?.n || 0);
}

async function markRead(customer_id, notification_id) {
  await ensureTable();
  const cid = toInt(customer_id, 0);
  const id = toInt(notification_id, 0);
  if (!cid || !id) return false;
  await sequelize.query(
    `UPDATE customer_notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = :id AND customer_id = :cid`,
    { replacements: { id, cid } }
  );
  return true;
}

async function markAllRead(customer_id) {
  await ensureTable();
  const cid = toInt(customer_id, 0);
  if (!cid) return 0;
  const [res] = await sequelize.query(
    `UPDATE customer_notifications
        SET read_at = CURRENT_TIMESTAMP
      WHERE customer_id = :cid AND read_at IS NULL`,
    { replacements: { cid } }
  );
  return Number(res?.affectedRows || 0);
}

module.exports = {
  create,
  listForCustomer,
  unreadCount,
  markRead,
  markAllRead,
};
