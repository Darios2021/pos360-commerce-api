// ✅ COPY-PASTE FINAL COMPLETO
// src/controllers/paymentMethod.controller.js

const { Op } = require("sequelize");
const { PaymentMethod } = require("../models");
const {
  buildPayload,
  validatePayload,
  ensureUniqueCode,
  toPublicDto,
  getActivePaymentMethods,
} = require("../services/paymentMethod.service");

function toInt(v, def = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function parseBool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;

  const s = String(v).trim().toLowerCase();
  if (!s) return def;

  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;

  return def;
}

function normalizeRoles(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((r) => String(r || "").toLowerCase()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminReq(req) {
  const u = req?.user || {};
  const roles = normalizeRoles(u.roles);

  if (roles.includes("admin") || roles.includes("superadmin") || roles.includes("super_admin")) return true;

  const role = String(u.role || u.user_role || "").toLowerCase();
  if (["admin", "superadmin", "super_admin"].includes(role)) return true;

  if (u.is_admin === true) return true;

  return false;
}

function rid(req) {
  return (
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function logPm(req, level, msg, extra = {}) {
  console[level](`[PAYMENT_METHODS] ${msg}`, {
    rid: req._rid,
    path: req.originalUrl,
    method: req.method,
    user_id: req?.user?.id ?? null,
    branch_id: req?.user?.branch_id ?? null,
    ...extra,
  });
}

async function adminList(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const branchId = toInt(req.query.branch_id || req.query.branchId, 0) || null;
    const activeOnly = parseBool(req.query.active_only, false);
    const q = String(req.query.q || "").trim();

    const where = {};

    if (branchId) where.branch_id = branchId;
    if (activeOnly) where.is_active = true;
    if (q) {
      where[Op.or] = [
        { code: { [Op.like]: `%${q}%` } },
        { name: { [Op.like]: `%${q}%` } },
        { provider_code: { [Op.like]: `%${q}%` } },
        { kind: { [Op.like]: `%${q}%` } },
      ];
    }

    const rows = await PaymentMethod.findAll({
      where,
      order: [
        ["branch_id", "ASC"],
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
    });

    return res.json({
      ok: true,
      data: rows.map(toPublicDto),
    });
  } catch (e) {
    logPm(req, "error", "adminList error", { err: e.message });
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHODS_LIST_ERROR",
      message: e.message,
    });
  }
}

async function adminGetOne(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "id inválido",
      });
    }

    const row = await PaymentMethod.findByPk(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        code: "PAYMENT_METHOD_NOT_FOUND",
        message: "Medio de pago no encontrado",
      });
    }

    return res.json({
      ok: true,
      data: toPublicDto(row),
    });
  } catch (e) {
    logPm(req, "error", "adminGetOne error", { err: e.message });
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHOD_GET_ERROR",
      message: e.message,
    });
  }
}

async function adminCreate(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const payload = buildPayload(req.body || {});
    validatePayload(payload, { isCreate: true });
    await ensureUniqueCode({
      branch_id: payload.branch_id,
      code: payload.code,
    });

    const row = await PaymentMethod.create(payload);

    return res.status(201).json({
      ok: true,
      data: toPublicDto(row),
      message: "Medio de pago creado",
    });
  } catch (e) {
    const status = e.httpStatus || 500;
    logPm(req, "error", "adminCreate error", { err: e.message, code: e.code });
    return res.status(status).json({
      ok: false,
      code: e.code || "PAYMENT_METHOD_CREATE_ERROR",
      message: e.message,
    });
  }
}

async function adminUpdate(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "id inválido",
      });
    }

    const row = await PaymentMethod.findByPk(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        code: "PAYMENT_METHOD_NOT_FOUND",
        message: "Medio de pago no encontrado",
      });
    }

    const payload = buildPayload({
      ...row.toJSON(),
      ...(req.body || {}),
    });

    validatePayload(payload, { isCreate: false });
    await ensureUniqueCode({
      branch_id: payload.branch_id,
      code: payload.code,
      excludeId: id,
    });

    await row.update(payload);

    return res.json({
      ok: true,
      data: toPublicDto(row),
      message: "Medio de pago actualizado",
    });
  } catch (e) {
    const status = e.httpStatus || 500;
    logPm(req, "error", "adminUpdate error", { err: e.message, code: e.code });
    return res.status(status).json({
      ok: false,
      code: e.code || "PAYMENT_METHOD_UPDATE_ERROR",
      message: e.message,
    });
  }
}

async function adminDelete(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "id inválido",
      });
    }

    const row = await PaymentMethod.findByPk(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        code: "PAYMENT_METHOD_NOT_FOUND",
        message: "Medio de pago no encontrado",
      });
    }

    if (row.is_system) {
      return res.status(400).json({
        ok: false,
        code: "PAYMENT_METHOD_SYSTEM_LOCKED",
        message: "No se puede eliminar un medio de sistema",
      });
    }

    await row.destroy();

    return res.json({
      ok: true,
      message: "Medio de pago eliminado",
    });
  } catch (e) {
    logPm(req, "error", "adminDelete error", { err: e.message });
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHOD_DELETE_ERROR",
      message: e.message,
    });
  }
}

async function adminToggleActive(req, res) {
  req._rid = req._rid || rid(req);

  try {
    if (!isAdminReq(req)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Solo administradores",
      });
    }

    const id = toInt(req.params.id, 0);
    if (!id) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "id inválido",
      });
    }

    const row = await PaymentMethod.findByPk(id);
    if (!row) {
      return res.status(404).json({
        ok: false,
        code: "PAYMENT_METHOD_NOT_FOUND",
        message: "Medio de pago no encontrado",
      });
    }

    await row.update({ is_active: !row.is_active });

    return res.json({
      ok: true,
      data: toPublicDto(row),
      message: row.is_active ? "Medio activado" : "Medio desactivado",
    });
  } catch (e) {
    logPm(req, "error", "adminToggleActive error", { err: e.message });
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHOD_TOGGLE_ERROR",
      message: e.message,
    });
  }
}

async function publicList(req, res) {
  req._rid = req._rid || rid(req);

  try {
    const branchId = toInt(req.query.branch_id || req.query.branchId, 0) || null;

    const rows = await getActivePaymentMethods({
      branchId,
      includeInactive: false,
    });

    return res.json({
      ok: true,
      data: rows,
      meta: {
        branch_id: branchId,
        total: rows.length,
      },
    });
  } catch (e) {
    logPm(req, "error", "publicList error", { err: e.message });
    return res.status(500).json({
      ok: false,
      code: "PAYMENT_METHODS_PUBLIC_LIST_ERROR",
      message: e.message,
    });
  }
}

module.exports = {
  adminList,
  adminGetOne,
  adminCreate,
  adminUpdate,
  adminDelete,
  adminToggleActive,
  publicList,
};