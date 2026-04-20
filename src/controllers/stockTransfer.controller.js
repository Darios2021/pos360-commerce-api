// src/controllers/stockTransfer.controller.js
"use strict";

const svc = require("../services/stockTransfer.service");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function isAdmin(req) {
  const roles = (req.access?.roles || req.user?.roles || []).map((r) =>
    typeof r === "string" ? r : r?.name || r?.code || ""
  );
  return roles.some((r) => ["super_admin","admin","superadmin"].includes(r.toLowerCase()));
}

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ ok: false, message: err.message });
}

// GET /stock/transfers
async function list(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const branchId   = toInt(req.ctx?.branchId || req.user?.branch_id, 0);
    const warehouseId = toInt(req.ctx?.warehouseId, 0);
    const role = isAdmin(req) ? "admin" : "user";

    const data = await svc.listTransfers({ branchId, warehouseId, status, role, page, limit });
    return res.json({ ok: true, ...data });
  } catch (err) { handleError(res, err); }
}

// GET /stock/transfers/:id
async function getById(req, res) {
  try {
    const transfer = await svc.getTransferById(toInt(req.params.id));
    if (!transfer) return res.status(404).json({ ok: false, message: "Derivación no encontrada" });

    // Sucursales solo ven sus propias derivaciones
    if (!isAdmin(req)) {
      const branchId = toInt(req.ctx?.branchId || req.user?.branch_id, 0);
      const warehouseId = toInt(req.ctx?.warehouseId, 0);
      const isOwner = toInt(transfer.from_warehouse_id) === warehouseId ||
                      toInt(transfer.to_branch_id)      === branchId;
      if (!isOwner) return res.status(403).json({ ok: false, message: "Sin acceso a esta derivación" });
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

module.exports = { list, getById, create, update, dispatch, receive, cancel };
