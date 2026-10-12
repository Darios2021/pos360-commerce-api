// src/controllers/stockCount.controller.js
// Conteos de stock. Contrato: docs/conteos-y-codigo.md
"use strict";

const svc = require("../services/stockCount.service");
const access = require("../utils/accessScope");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

// Rol y ámbito del request. isAdmin = los mismos que pueden POST /stock/init.
function actorOf(req) {
  return {
    userId: access.getUserId(req),
    isSuperAdmin: access.isSuperAdmin(req),
    isAdmin: access.isBranchAdmin(req),
    allowedBranchIds: access.getAllowedBranchIds(req),
  };
}

function handleError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error("[stockCount]", err?.message || err);
  const body = { ok: false, code: err.code || (status >= 500 ? "STOCK_COUNT_ERROR" : "ERROR"), message: err.message };
  if (err.product_id) body.product_id = err.product_id;
  return res.status(status).json(body);
}

// GET /stock/counts
async function list(req, res) {
  try {
    const { status, warehouse_id, page, limit } = req.query;
    const data = await svc.listCounts({ status, warehouse_id, page, limit }, actorOf(req));
    return res.json({ ok: true, ...data });
  } catch (err) { handleError(res, err); }
}

// GET /stock/counts/:id
async function getById(req, res) {
  try {
    const count = await svc.getCountById(toInt(req.params.id), actorOf(req));
    return res.json({ ok: true, count });
  } catch (err) { handleError(res, err); }
}

// POST /stock/counts
async function create(req, res) {
  try {
    const body = req.body || {};
    const warehouse_id = toInt(body.warehouse_id, 0) || toInt(req.ctx?.warehouseId, 0);
    const count = await svc.createCount({ warehouse_id, motivo: body.motivo, items: body.items }, actorOf(req));
    return res.status(201).json({ ok: true, count });
  } catch (err) { handleError(res, err); }
}

// PUT /stock/counts/:id
async function update(req, res) {
  try {
    const { mode, items, remove_product_ids, motivo } = req.body || {};
    const count = await svc.updateCount(toInt(req.params.id), { mode, items, remove_product_ids, motivo }, actorOf(req));
    return res.json({ ok: true, count });
  } catch (err) { handleError(res, err); }
}

// POST /stock/counts/:id/submit
async function submit(req, res) {
  try {
    const count = await svc.submitCount(toInt(req.params.id), { motivo: req.body?.motivo }, actorOf(req));
    return res.json({ ok: true, count });
  } catch (err) { handleError(res, err); }
}

// POST /stock/counts/:id/apply  (sólo administrador)
async function apply(req, res) {
  try {
    const result = await svc.applyCount(toInt(req.params.id), { motivo: req.body?.motivo }, actorOf(req));
    return res.json({ ok: true, ...result });
  } catch (err) { handleError(res, err); }
}

// POST /stock/counts/:id/cancel
async function cancel(req, res) {
  try {
    const count = await svc.cancelCount(toInt(req.params.id), actorOf(req));
    return res.json({ ok: true, count });
  } catch (err) { handleError(res, err); }
}

module.exports = { list, getById, create, update, submit, apply, cancel };
