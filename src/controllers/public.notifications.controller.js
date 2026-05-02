// src/controllers/public.notifications.controller.js
//
// Centro de notificaciones del cliente del shop.
// Todas las rutas requieren sesión activa (cookie o Bearer).

const { getShopCustomerFromRequest } = require("../services/shopSession.service");
const notifs = require("../services/customerNotifications.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

async function requireCustomer(req, res) {
  const c = await getShopCustomerFromRequest(req);
  if (!c?.id) {
    res.status(401).json({ ok: false, code: "NOT_LOGGED_IN" });
    return null;
  }
  return c;
}

// GET /api/v1/public/notifications?limit=30&offset=0&only_unread=1&type=order_status
async function list(req, res) {
  try {
    const customer = await requireCustomer(req, res);
    if (!customer) return;
    const out = await notifs.listForCustomer(customer.id, {
      limit: toInt(req.query.limit, 30),
      offset: toInt(req.query.offset, 0),
      only_unread: String(req.query.only_unread || "") === "1",
      type: req.query.type || null,
    });
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("public.notifications.list:", e?.message);
    return res.status(500).json({ ok: false, message: "Error listando notificaciones" });
  }
}

// GET /api/v1/public/notifications/unread-count
async function unreadCount(req, res) {
  try {
    const customer = await requireCustomer(req, res);
    if (!customer) return;
    const n = await notifs.unreadCount(customer.id);
    return res.json({ ok: true, count: n });
  } catch (e) {
    console.error("public.notifications.unreadCount:", e?.message);
    return res.status(500).json({ ok: false, message: "Error contando no leídas" });
  }
}

// POST /api/v1/public/notifications/:id/read
async function markRead(req, res) {
  try {
    const customer = await requireCustomer(req, res);
    if (!customer) return;
    await notifs.markRead(customer.id, toInt(req.params.id, 0));
    return res.json({ ok: true });
  } catch (e) {
    console.error("public.notifications.markRead:", e?.message);
    return res.status(500).json({ ok: false, message: "Error marcando leída" });
  }
}

// POST /api/v1/public/notifications/read-all
async function markAllRead(req, res) {
  try {
    const customer = await requireCustomer(req, res);
    if (!customer) return;
    const n = await notifs.markAllRead(customer.id);
    return res.json({ ok: true, marked: n });
  } catch (e) {
    console.error("public.notifications.markAllRead:", e?.message);
    return res.status(500).json({ ok: false, message: "Error marcando todas" });
  }
}

module.exports = { list, unreadCount, markRead, markAllRead };
