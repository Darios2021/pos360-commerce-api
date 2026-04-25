// src/controllers/stockTransfer.controller.js
"use strict";

const svc = require("../services/stockTransfer.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// Roles del usuario (case-insensitive). Soporta string/obj.
function rolesOf(req) {
  return (req.access?.roles || req.user?.roles || []).map((r) =>
    String(typeof r === "string" ? r : r?.name || r?.code || "").toLowerCase().trim()
  );
}

// super_admin = único rol que ve TODAS las sucursales.
// Cualquier otro usuario (incluido un "admin" de sucursal) queda scopeado a su branch.
function isSuperAdmin(req) {
  if (req.ctx?.isSuperAdmin === true) return true;
  return rolesOf(req).some((r) => ["super_admin", "superadmin"].includes(r));
}

// Solo admin / super_admin pueden eliminar derivaciones.
function canDeleteTransfer(req) {
  return rolesOf(req).some((r) => ["super_admin", "superadmin", "admin"].includes(r));
}

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ ok: false, message: err.message });
}

// GET /stock/transfers
async function list(req, res) {
  try {
    const { status, page = 1, limit = 20, search = "", q = "" } = req.query;
    const branchId   = toInt(req.ctx?.branchId || req.user?.branch_id, 0);
    const warehouseId = toInt(req.ctx?.warehouseId, 0);
    const allowedBranchIds = Array.isArray(req.ctx?.allowedBranchIds)
      ? req.ctx.allowedBranchIds.map((x) => toInt(x, 0)).filter(Boolean)
      : [];

    const data = await svc.listTransfers({
      branchId,
      warehouseId,
      allowedBranchIds,
      status,
      search: search || q,
      isSuperAdmin: isSuperAdmin(req),
      page,
      limit,
    });
    return res.json({ ok: true, ...data });
  } catch (err) { handleError(res, err); }
}

// GET /stock/transfers/:id
async function getById(req, res) {
  try {
    const transfer = await svc.getTransferById(toInt(req.params.id));
    if (!transfer) return res.status(404).json({ ok: false, message: "Derivación no encontrada" });

    // Sucursales solo ven sus propias derivaciones (super_admin ve todo)
    if (!isSuperAdmin(req)) {
      const branchId = toInt(req.ctx?.branchId || req.user?.branch_id, 0);
      const warehouseId = toInt(req.ctx?.warehouseId, 0);
      const allowedBranchIds = Array.isArray(req.ctx?.allowedBranchIds)
        ? req.ctx.allowedBranchIds.map((x) => toInt(x, 0)).filter(Boolean)
        : [];

      const fromBranchId = toInt(transfer.fromWarehouse?.branch_id, 0);
      const toBranchId   = toInt(transfer.to_branch_id, 0);

      const matchesActive =
        toInt(transfer.from_warehouse_id) === warehouseId ||
        fromBranchId === branchId ||
        toBranchId === branchId;
      const matchesAllowed =
        (fromBranchId && allowedBranchIds.includes(fromBranchId)) ||
        (toBranchId   && allowedBranchIds.includes(toBranchId));

      if (!matchesActive && !matchesAllowed) {
        return res.status(403).json({ ok: false, message: "Sin acceso a esta derivación" });
      }
    }

    return res.json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers
async function create(req, res) {
  try {
    const from_warehouse_id = toInt(req.ctx?.warehouseId || req.body.from_warehouse_id, 0);
    const { to_branch_id, items, note } = req.body;
    const created_by = toInt(req.user?.id || req.user?.sub, 0);

    if (!from_warehouse_id) return res.status(400).json({ ok: false, message: "Depósito origen requerido" });
    if (!toInt(to_branch_id)) return res.status(400).json({ ok: false, message: "Sucursal destino requerida" });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, message: "Items requeridos" });

    const transfer = await svc.createTransfer({ from_warehouse_id, to_branch_id: toInt(to_branch_id), items, note, created_by });
    return res.status(201).json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// PUT /stock/transfers/:id  (editar draft)
async function update(req, res) {
  try {
    const { items, note } = req.body;
    const created_by = toInt(req.user?.id || req.user?.sub, 0);
    const transfer = await svc.updateDraft(toInt(req.params.id), { items: items || [], note, created_by });
    return res.json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers/:id/dispatch
async function dispatch(req, res) {
  try {
    const dispatched_by = toInt(req.user?.id || req.user?.sub, 0);
    const transfer = await svc.dispatchTransfer(toInt(req.params.id), { dispatched_by });
    return res.json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers/:id/receive
async function receive(req, res) {
  try {
    const { receptions } = req.body;
    const received_by = toInt(req.user?.id || req.user?.sub, 0);

    if (!Array.isArray(receptions))
      return res.status(400).json({ ok: false, message: "Recepciones requeridas" });
    // Array vacío es válido para transferencias sin productos (el servicio valida internamente)

    const transfer = await svc.receiveTransfer(toInt(req.params.id), { receptions, received_by });
    return res.json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers/:id/cancel
async function cancel(req, res) {
  try {
    const cancelled_by = toInt(req.user?.id || req.user?.sub, 0);
    const transfer = await svc.cancelTransfer(toInt(req.params.id), { cancelled_by });
    return res.json({ ok: true, transfer });
  } catch (err) { handleError(res, err); }
}

// DELETE /stock/transfers/:id  (hard-delete, solo admin/super_admin)
async function remove(req, res) {
  try {
    if (!canDeleteTransfer(req)) {
      return res.status(403).json({
        ok: false,
        message: "Solo administradores pueden eliminar derivaciones.",
      });
    }
    const deleted_by = toInt(req.user?.id || req.user?.sub, 0);
    const result = await svc.deleteTransfer(toInt(req.params.id), { deleted_by });
    return res.json({ ok: true, ...result });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers/bulk/receive  (recepción masiva)
async function bulkReceive(req, res) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ ok: false, message: "ids requerido (array)" });
    }
    const received_by = toInt(req.user?.id || req.user?.sub, 0);
    const result = await svc.bulkReceiveTransfers(ids, { received_by });
    return res.json({ ok: true, ...result });
  } catch (err) { handleError(res, err); }
}

// POST /stock/transfers/bulk/delete  (eliminación masiva, solo admin/super_admin)
async function bulkDelete(req, res) {
  try {
    if (!canDeleteTransfer(req)) {
      return res.status(403).json({
        ok: false,
        message: "Solo administradores pueden eliminar derivaciones.",
      });
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ ok: false, message: "ids requerido (array)" });
    }
    const deleted_by = toInt(req.user?.id || req.user?.sub, 0);
    const result = await svc.bulkDeleteTransfers(ids, { deleted_by });
    return res.json({ ok: true, ...result });
  } catch (err) { handleError(res, err); }
}

module.exports = { list, getById, create, update, dispatch, receive, cancel, remove, bulkReceive, bulkDelete };
