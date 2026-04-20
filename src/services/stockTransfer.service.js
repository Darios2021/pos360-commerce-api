// src/services/stockTransfer.service.js
"use strict";

const { sequelize, StockTransfer, StockTransferItem, StockBalance, StockMovement, StockMovementItem,
        Warehouse, Branch, Product, ProductImage, User } = require("../models");
const { Op } = require("sequelize");

// ─── helpers ────────────────────────────────────────────────────────────────
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toDecimal(v) {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Genera número de derivación: DER-YYYY-NNNNNN */
async function generateNumber(t) {
  const year = new Date().getFullYear();
  const prefix = `DER-${year}-`;
  const last = await StockTransfer.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["id", "DESC"]],
    lock: t ? true : false,
    transaction: t,
  });
  const seq = last ? toInt(last.number.replace(prefix, "")) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

// ─── CREATE DRAFT ────────────────────────────────────────────────────────────
/**
 * Crea una derivación en estado DRAFT.
 * items: [{ product_id, qty_sent, unit_cost?, note? }]
 * Si el producto NO existe en product_branches de la sucursal destino,
 * lo registramos igual — se creará al momento de la recepción.
 */
async function createTransfer({ from_warehouse_id, to_branch_id, items = [], note, created_by }) {
  if (!items.length) throw Object.assign(new Error("Debe incluir al menos un producto"), { status: 400 });

  const fromWh = await Warehouse.findByPk(from_warehouse_id);
  if (!fromWh) throw Object.assign(new Error("Depósito origen no encontrado"), { status: 404 });

  const toBranch = await Branch.findByPk(to_branch_id);
  if (!toBranch) throw Object.assign(new Error("Sucursal destino no encontrada"), { status: 404 });

  const toWh = await Warehouse.findOne({ where: { branch_id: to_branch_id, is_active: true } });
  if (!toWh) throw Object.assign(new Error("La sucursal destino no tiene depósito activo"), { status: 422 });

  if (toInt(from_warehouse_id) === toInt(toWh.id))
    throw Object.assign(new Error("Origen y destino no pueden ser el mismo depósito"), { status: 400 });

  return sequelize.transaction(async (t) => {
    const number = await generateNumber(t);

    const transfer = await StockTransfer.create({
      number, from_warehouse_id, to_warehouse_id: toWh.id,
      to_branch_id, status: "draft", note, created_by,
    }, { transaction: t });

    const rows = items.map((it) => ({
      transfer_id:  transfer.id,
      product_id:   toInt(it.product_id),
      qty_sent:     toDecimal(it.qty_sent),
      unit_cost:    it.unit_cost != null ? toDecimal(it.unit_cost) : null,
      note:         it.note || null,
    }));

    await StockTransferItem.bulkCreate(rows, { transaction: t });
    return getTransferById(transfer.id, t);
  });
}

// ─── UPDATE DRAFT ────────────────────────────────────────────────────────────
async function updateDraft(transfer_id, { items = [], note, created_by }) {
  const transfer = await StockTransfer.findByPk(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });
  if (transfer.status !== "draft")
    throw Object.assign(new Error("Solo se puede editar una derivación en borrador"), { status: 422 });

  return sequelize.transaction(async (t) => {
    if (note !== undefined) await transfer.update({ note }, { transaction: t });

    if (items.length) {
      await StockTransferItem.destroy({ where: { transfer_id }, transaction: t });
      const rows = items.map((it) => ({
        transfer_id,
        product_id: toInt(it.product_id),
        qty_sent:   toDecimal(it.qty_sent),
        unit_cost:  it.unit_cost != null ? toDecimal(it.unit_cost) : null,
        note:       it.note || null,
      }));
      await StockTransferItem.bulkCreate(rows, { transaction: t });
    }
    return getTransferById(transfer_id, t);
  });
}

// ─── DISPATCH ────────────────────────────────────────────────────────────────
/**
 * Despacha la derivación: descuenta stock de la sucursal origen.
 */
async function dispatchTransfer(transfer_id, { dispatched_by }) {
  const transfer = await getTransferById(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });
  if (transfer.status !== "draft")
    throw Object.assign(new Error("Solo se puede despachar una derivación en borrador"), { status: 422 });

  return sequelize.transaction(async (t) => {
    // ── Validar stock disponible ANTES de descontar ──────────────────────────
    for (const item of transfer.items) {
      const qty = toDecimal(item.qty_sent);
      const [[balance]] = await sequelize.query(
        `SELECT COALESCE(qty, 0) AS qty FROM stock_balances
         WHERE warehouse_id = :wh AND product_id = :prod`,
        { replacements: { wh: transfer.from_warehouse_id, prod: item.product_id }, transaction: t }
      );
      const available = toDecimal(balance?.qty);
      if (available < qty) {
        const name = item.product?.name || `Producto #${item.product_id}`;
        throw Object.assign(
          new Error(`Stock insuficiente para "${name}": disponible ${available}, requerido ${qty}`),
          { status: 422 }
        );
      }
    }

    // Crear stock_movement OUT desde origen
    const movement = await StockMovement.create({
      type: "out",
      warehouse_id: transfer.from_warehouse_id,
      from_warehouse_id: transfer.from_warehouse_id,
      to_warehouse_id:   transfer.to_warehouse_id,
      ref_type: "transfer_dispatch",
      ref_id:   String(transfer.id),
      note:     `Derivación ${transfer.number} despachada`,
      created_by: dispatched_by,
    }, { transaction: t });

    // Items del movimiento + descontar stock origen
    for (const item of transfer.items) {
      const qty = toDecimal(item.qty_sent);
      await StockMovementItem.create({
        movement_id: movement.id,
        product_id:  item.product_id,
        qty,
      }, { transaction: t });

      // Descontar del balance origen
      await sequelize.query(`
        INSERT INTO stock_balances (warehouse_id, product_id, qty)
        VALUES (:wh, :prod, :neg_qty)
        ON DUPLICATE KEY UPDATE qty = qty + :neg_qty
      `, {
        replacements: { wh: transfer.from_warehouse_id, prod: item.product_id, neg_qty: -qty },
        transaction: t,
      });
    }

    await transfer.update({
      status: "dispatched",
      dispatched_at: new Date(),
      dispatched_by,
    }, { transaction: t });

    return getTransferById(transfer_id, t);
  });
}

// ─── RECEIVE ─────────────────────────────────────────────────────────────────
/**
 * Recepciona la derivación en la sucursal destino.
 * receptions: [{ item_id, qty_received, note? }]
 * - Suma stock en destino
 * - Si el producto es nuevo para esa sucursal, crea la entrada en product_branches
 * - Si todas las qtys coinciden → RECEIVED; si alguna difiere → PARTIAL
 */
async function receiveTransfer(transfer_id, { receptions = [], received_by }) {
  const transfer = await getTransferById(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });
  if (transfer.status !== "dispatched")
    throw Object.assign(new Error("Solo se puede recepcionar una derivación despachada"), { status: 422 });
  // Si la derivación no tiene items, permitir recepción vacía (confirma entrega sin productos)
  if (!receptions.length && (transfer.items?.length ?? 0) > 0)
    throw Object.assign(new Error("Debe enviar las cantidades recibidas"), { status: 400 });

  return sequelize.transaction(async (t) => {
    const movement = await StockMovement.create({
      type: "in",
      warehouse_id: transfer.to_warehouse_id,
      from_warehouse_id: transfer.from_warehouse_id,
      to_warehouse_id:   transfer.to_warehouse_id,
      ref_type: "transfer_receive",
      ref_id:   String(transfer.id),
      note:     `Derivación ${transfer.number} recepcionada`,
      created_by: received_by,
    }, { transaction: t });

    let hasPartial = false;

    for (const rec of receptions) {
      const item = transfer.items.find((i) => toInt(i.id) === toInt(rec.item_id));
      if (!item) continue;

      const qtyReceived = toDecimal(rec.qty_received);
      if (toDecimal(item.qty_sent) !== qtyReceived) hasPartial = true;

      await StockTransferItem.update(
        { qty_received: qtyReceived, note: rec.note || item.note },
        { where: { id: item.id }, transaction: t }
      );

      if (qtyReceived > 0) {
        await StockMovementItem.create({
          movement_id: movement.id,
          product_id:  item.product_id,
          qty:         qtyReceived,
        }, { transaction: t });

        // Asegurar que el producto existe en product_branches destino
        await sequelize.query(`
          INSERT IGNORE INTO product_branches (product_id, branch_id, is_active, created_at)
          VALUES (:prod, :branch, 1, NOW())
        `, { replacements: { prod: item.product_id, branch: transfer.to_branch_id }, transaction: t });

        // Sumar stock en destino
        await sequelize.query(`
          INSERT INTO stock_balances (warehouse_id, product_id, qty)
          VALUES (:wh, :prod, :qty)
          ON DUPLICATE KEY UPDATE qty = qty + :qty
        `, {
          replacements: { wh: transfer.to_warehouse_id, prod: item.product_id, qty: qtyReceived },
          transaction: t,
        });
      }
    }

    const newStatus = hasPartial ? "partial" : "received";
    await transfer.update({
      status: newStatus,
      received_at: new Date(),
      received_by,
    }, { transaction: t });

    return getTransferById(transfer_id, t);
  });
}

// ─── CANCEL ──────────────────────────────────────────────────────────────────
async function cancelTransfer(transfer_id, { cancelled_by }) {
  const transfer = await StockTransfer.findByPk(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });
  if (!["draft"].includes(transfer.status))
    throw Object.assign(new Error("Solo se puede cancelar una derivación en borrador"), { status: 422 });

  await transfer.update({ status: "cancelled" });
  return getTransferById(transfer_id);
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
async function listTransfers({ branchId, warehouseId, status, role, page = 1, limit = 20 }) {
  const where = {};
  const isAdmin = role === "admin" || role === "super_admin";

  if (status) where.status = status;

  // Central ve lo que despachó; sucursal ve lo que le enviaron
  if (!isAdmin) {
    where[Op.or] = [
      { from_warehouse_id: warehouseId },
      { to_branch_id: branchId },
    ];
  }

  const { rows, count } = await StockTransfer.findAndCountAll({
    where,
    include: [
      { model: Warehouse, as: "fromWarehouse", include: [{ model: Branch, as: "branch" }] },
      { model: Warehouse, as: "toWarehouse",   include: [{ model: Branch, as: "branch" }] },
      { model: User, as: "creator",    attributes: ["id","first_name","last_name"] },
      { model: User, as: "dispatcher", attributes: ["id","first_name","last_name"] },
      { model: User, as: "receiver",   attributes: ["id","first_name","last_name"] },
    ],
    order: [["created_at", "DESC"]],
    limit: toInt(limit, 20),
    offset: (toInt(page, 1) - 1) * toInt(limit, 20),
  });

  return { transfers: rows, total: count, page: toInt(page, 1), limit: toInt(limit, 20) };
}

// ─── GET BY ID ────────────────────────────────────────────────────────────────
async function getTransferById(id, transaction) {
  return StockTransfer.findByPk(id, {
    include: [
      { model: Warehouse, as: "fromWarehouse", include: [{ model: Branch, as: "branch" }] },
      { model: Warehouse, as: "toWarehouse",   include: [{ model: Branch, as: "branch" }] },
      { model: User, as: "creator",    attributes: ["id","first_name","last_name"] },
      { model: User, as: "dispatcher", attributes: ["id","first_name","last_name"] },
      { model: User, as: "receiver",   attributes: ["id","first_name","last_name"] },
      {
        model: StockTransferItem,
        as: "items",
        include: [{
          model: Product,
          as: "product",
          attributes: ["id","name","sku","barcode"],
          include: [{ model: ProductImage, as: "images", attributes: ["url","sort_order"], order: [["sort_order","ASC"]], limit: 1 }],
        }],
      },
    ],
    transaction,
  });
}

module.exports = { createTransfer, updateDraft, dispatchTransfer, receiveTransfer,
                   cancelTransfer, listTransfers, getTransferById };
