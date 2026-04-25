// src/services/stockTransfer.service.js
"use strict";

const { sequelize, StockTransfer, StockTransferItem, StockBalance, StockMovement, StockMovementItem,
        Warehouse, Branch, Product, ProductImage, User } = require("../models");
const { Op } = require("sequelize");
const socketService = require("./socket.service");

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

  const result = await sequelize.transaction(async (t) => {
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

  // Telegram: alerta inmediata al despachar (post-commit ya no es necesario, transaction cerrada).
  try {
    console.log(`[stockTransfer.dispatchTransfer] disparando notifyTransferDispatched para transfer=${result.id}`);
    const tg = require("./telegramNotifier.service");
    tg.notifyTransferDispatched({ transfer_id: result.id }).catch((e) =>
      console.warn("[stockTransfer.dispatchTransfer] notifyTransferDispatched error:", e?.message)
    );
  } catch (e) {
    console.warn("[stockTransfer.dispatchTransfer] no se pudo cargar notifier:", e?.message);
  }

  // Notificar a la sucursal DESTINO que hay un nuevo paquete en camino
  try {
    socketService.emitToBranch(result.to_branch_id, "transfer:dispatched", {
      id:             result.id,
      number:         result.number,
      from_branch:    result.fromWarehouse?.branch?.name || "—",
      item_count:     result.items?.length || 0,
      dispatched_at:  result.dispatched_at,
    });
  } catch {}

  return result;
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

  const result = await sequelize.transaction(async (t) => {
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

  // Telegram: alerta de recepción.
  try {
    console.log(`[stockTransfer.receiveTransfer] disparando notifyTransferReceived para transfer=${result.id}`);
    const tg = require("./telegramNotifier.service");
    tg.notifyTransferReceived({ transfer_id: result.id }).catch((e) =>
      console.warn("[stockTransfer.receiveTransfer] notifyTransferReceived error:", e?.message)
    );
  } catch (e) {
    console.warn("[stockTransfer.receiveTransfer] no se pudo cargar notifier:", e?.message);
  }

  // Notificar a la sucursal ORIGEN que su envío fue recepcionado
  try {
    const fromBranchId = result.fromWarehouse?.branch_id;
    if (fromBranchId) {
      socketService.emitToBranch(fromBranchId, "transfer:received", {
        id:          result.id,
        number:      result.number,
        status:      result.status,
        to_branch:   result.toBranch?.name || result.toWarehouse?.branch?.name || "—",
        received_at: result.received_at,
      });
    }
    // También notificar al destino para que actualice su lista
    socketService.emitToBranch(result.to_branch_id, "transfer:received", {
      id:     result.id,
      number: result.number,
      status: result.status,
    });
  } catch {}

  return result;
}

// ─── CANCEL ──────────────────────────────────────────────────────────────────
async function cancelTransfer(transfer_id, { cancelled_by }) {
  const transfer = await StockTransfer.findByPk(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });
  if (["cancelled", "received"].includes(transfer.status))
    throw Object.assign(new Error("No se puede cancelar una derivación ya recibida o cancelada"), { status: 422 });

  await transfer.update({ status: "cancelled" });
  const result = await getTransferById(transfer_id);

  // Notificar a ambas sucursales que se canceló
  try {
    const fromBranchId = result.fromWarehouse?.branch_id;
    const payload = { id: result.id, number: result.number, status: "cancelled" };
    if (fromBranchId)        socketService.emitToBranch(fromBranchId,       "transfer:cancelled", payload);
    if (result.to_branch_id) socketService.emitToBranch(result.to_branch_id, "transfer:cancelled", payload);
  } catch {}

  return result;
}

// ─── DELETE (hard) ────────────────────────────────────────────────────────────
/**
 * Hard-delete de una derivación. Reversión total de stock según el estado:
 *   - draft / cancelled → solo borra (no hubo movimiento de stock).
 *   - dispatched        → restaura qty_sent al depósito origen.
 *   - received          → restaura qty_sent al origen y descuenta qty_received del destino.
 *   - partial           → ídem received (qty_received puede diferir de qty_sent).
 *
 * La autorización (admin / super_admin) la valida el controller.
 * Esta función asume que el llamador tiene permiso para revertir el stock.
 *
 * Limitación: si se descuenta del destino productos ya vendidos, el balance
 * puede quedar negativo. Es responsabilidad del admin saber lo que hace.
 */
async function deleteTransfer(transfer_id, { deleted_by } = {}) {
  const transfer = await getTransferById(transfer_id);
  if (!transfer) throw Object.assign(new Error("Derivación no encontrada"), { status: 404 });

  const status = String(transfer.status || "").toLowerCase();
  const restoreOrigin = ["dispatched", "received", "partial"].includes(status);
  const removeDest    = ["received", "partial"].includes(status);

  return sequelize.transaction(async (t) => {
    if (restoreOrigin || removeDest) {
      for (const item of transfer.items || []) {
        const qtySent     = toDecimal(item.qty_sent);
        const qtyReceived = toDecimal(item.qty_received);

        // Sumar al origen lo que se había descontado en el dispatch.
        if (restoreOrigin && qtySent > 0) {
          await sequelize.query(`
            INSERT INTO stock_balances (warehouse_id, product_id, qty)
            VALUES (:wh, :prod, :qty)
            ON DUPLICATE KEY UPDATE qty = qty + :qty
          `, {
            replacements: { wh: transfer.from_warehouse_id, prod: item.product_id, qty: qtySent },
            transaction: t,
          });
        }

        // Quitar del destino lo que se había recibido (puede dejar balance negativo).
        if (removeDest && qtyReceived > 0) {
          await sequelize.query(`
            INSERT INTO stock_balances (warehouse_id, product_id, qty)
            VALUES (:wh, :prod, :neg_qty)
            ON DUPLICATE KEY UPDATE qty = qty + :neg_qty
          `, {
            replacements: {
              wh: transfer.to_warehouse_id,
              prod: item.product_id,
              neg_qty: -qtyReceived,
            },
            transaction: t,
          });
        }
      }

      // Borrar movements (dispatch + receive) y sus items relacionados.
      const movements = await StockMovement.findAll({
        where: {
          ref_type: { [Op.in]: ["transfer_dispatch", "transfer_receive"] },
          ref_id: String(transfer.id),
        },
        attributes: ["id"],
        transaction: t,
      });
      const movementIds = movements.map((m) => m.id);
      if (movementIds.length) {
        await StockMovementItem.destroy({
          where: { movement_id: { [Op.in]: movementIds } },
          transaction: t,
        });
        await StockMovement.destroy({
          where: { id: { [Op.in]: movementIds } },
          transaction: t,
        });
      }
    }

    // Borrar items y la transfer.
    await StockTransferItem.destroy({ where: { transfer_id }, transaction: t });
    await StockTransfer.destroy({ where: { id: transfer_id }, transaction: t });

    return {
      id: transfer_id,
      deleted: true,
      restored_origin: restoreOrigin,
      removed_from_destination: removeDest,
    };
  });
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
// Scope: solo super_admin ve todas las derivaciones del sistema. Cualquier
// otro usuario (incluido un "admin" de sucursal) queda restringido a las
// derivaciones que tocan su sucursal activa o las sucursales habilitadas
// en user_branches (allowedBranchIds).
async function listTransfers({ branchId, warehouseId, allowedBranchIds = [], status, search, isSuperAdmin = false, page = 1, limit = 20 }) {
  const cleanLimit = Math.min(50, Math.max(1, toInt(limit, 20)));
  const cleanPage  = Math.max(1, toInt(page, 1));

  // 1) Construir cláusula de scope (independiente de status/search) para reutilizar en el conteo por estado.
  const scopeWhere = {};

  if (!isSuperAdmin) {
    const branchIds = Array.from(new Set([
      ...(Array.isArray(allowedBranchIds) ? allowedBranchIds : []),
      branchId,
    ].map((x) => toInt(x, 0)).filter(Boolean)));

    const ors = [];
    if (warehouseId) ors.push({ from_warehouse_id: warehouseId });
    if (branchIds.length) {
      ors.push({ to_branch_id: { [Op.in]: branchIds } });
      const origWhs = await Warehouse.findAll({
        where: { branch_id: { [Op.in]: branchIds } },
        attributes: ["id"],
      });
      const origWhIds = origWhs.map((w) => toInt(w.id, 0)).filter(Boolean);
      if (origWhIds.length) ors.push({ from_warehouse_id: { [Op.in]: origWhIds } });
    }

    if (!ors.length) {
      return {
        transfers: [],
        total: 0,
        page: cleanPage,
        limit: cleanLimit,
        count_by_status: {},
      };
    }
    scopeWhere[Op.or] = ors;
  }

  // 2) Where con filtros de status + search aplicados.
  const where = { ...scopeWhere };
  if (status) where.status = status;

  const q = String(search || "").trim();
  if (q) {
    const like = `%${q}%`;
    const searchOr = [
      { number: { [Op.like]: like } },
      { note:   { [Op.like]: like } },
    ];
    where[Op.and] = [...(where[Op.and] || []), { [Op.or]: searchOr }];
  }

  // 3) Paginación + conteos por estado en paralelo.
  const [page_result, statusRows] = await Promise.all([
    StockTransfer.findAndCountAll({
      where,
      include: [
        { model: Warehouse, as: "fromWarehouse", include: [{ model: Branch, as: "branch" }] },
        { model: Warehouse, as: "toWarehouse",   include: [{ model: Branch, as: "branch" }] },
        { model: User, as: "creator",    attributes: ["id","first_name","last_name"] },
        { model: User, as: "dispatcher", attributes: ["id","first_name","last_name"] },
        { model: User, as: "receiver",   attributes: ["id","first_name","last_name"] },
        { model: StockTransferItem, as: "items", attributes: ["id"] },
      ],
      order: [["created_at", "DESC"]],
      limit: cleanLimit,
      offset: (cleanPage - 1) * cleanLimit,
      distinct: true,
    }),
    StockTransfer.findAll({
      where: scopeWhere,
      attributes: [
        "status",
        [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
      ],
      group: ["status"],
      raw: true,
    }),
  ]);

  const count_by_status = {};
  for (const r of statusRows || []) {
    count_by_status[String(r.status || "unknown")] = toInt(r.cnt, 0);
  }
  const total_all = Object.values(count_by_status).reduce((a, b) => a + b, 0);

  return {
    transfers: page_result.rows,
    total: page_result.count,
    total_all,
    count_by_status,
    page: cleanPage,
    limit: cleanLimit,
  };
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

// ─── BULK RECEIVE ────────────────────────────────────────────────────────────
/**
 * Recepción masiva. Para cada id `dispatched`, marca todas las cantidades
 * recibidas iguales a las enviadas (qty_received = qty_sent → status RECEIVED).
 * Devuelve el detalle por id (ok / error / skipped).
 */
async function bulkReceiveTransfers(ids = [], { received_by } = {}) {
  const cleanIds = Array.from(new Set((ids || []).map((x) => toInt(x, 0)).filter(Boolean)));
  const results = [];

  for (const id of cleanIds) {
    try {
      const tr = await getTransferById(id);
      if (!tr) {
        results.push({ id, ok: false, skipped: true, reason: "not_found" });
        continue;
      }
      if (String(tr.status).toLowerCase() !== "dispatched") {
        results.push({ id, ok: false, skipped: true, reason: `status_${tr.status}` });
        continue;
      }

      const receptions = (tr.items || []).map((it) => ({
        item_id: it.id,
        qty_received: toDecimal(it.qty_sent),
      }));

      const result = await receiveTransfer(id, { receptions, received_by });
      results.push({ id, ok: true, status: result?.status });
    } catch (e) {
      results.push({ id, ok: false, error: e?.message || "error" });
    }
  }

  const ok    = results.filter((r) => r.ok).length;
  const fail  = results.length - ok;
  return { results, summary: { total: results.length, ok, fail } };
}

// ─── BULK DELETE ─────────────────────────────────────────────────────────────
async function bulkDeleteTransfers(ids = [], { deleted_by } = {}) {
  const cleanIds = Array.from(new Set((ids || []).map((x) => toInt(x, 0)).filter(Boolean)));
  const results = [];

  for (const id of cleanIds) {
    try {
      const r = await deleteTransfer(id, { deleted_by });
      results.push({ id, ok: true, ...r });
    } catch (e) {
      results.push({ id, ok: false, error: e?.message || "error" });
    }
  }

  const ok   = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  return { results, summary: { total: results.length, ok, fail } };
}

module.exports = { createTransfer, updateDraft, dispatchTransfer, receiveTransfer,
                   cancelTransfer, deleteTransfer, listTransfers, getTransferById,
                   bulkReceiveTransfers, bulkDeleteTransfers };
