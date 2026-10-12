// src/services/stockCount.service.js
// Conteos de stock guardados en el servidor (teléfono como cargador).
// Contrato: docs/conteos-y-codigo.md
//
// Estados: draft -> pending -> applied, draft -> applied (administrador),
//          draft|pending -> cancelled.
//
// El ámbito y el rol llegan en `actor` (lo arma el controller):
//   { userId, isSuperAdmin, isAdmin, allowedBranchIds }
// isAdmin = mismos roles que hoy pueden POST /stock/init (super_admin o admin).
"use strict";

const { Op, QueryTypes } = require("sequelize");
const {
  sequelize, StockCount, StockCountItem, StockMovement, StockMovementItem,
  Warehouse, Branch, Product, ProductImage, User,
} = require("../models");

const OPEN = ["draft", "pending"];
const STATUSES = ["draft", "pending", "applied", "cancelled"];
const MODES = ["reemplazar", "sumar", "reemplazar_todo"];

// ─── helpers ────────────────────────────────────────────────────────────────
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// DECIMAL(14,3): todo se redondea a 3 decimales para no arrastrar error de float.
function r3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function fmt(n) {
  return n === null || n === undefined ? null : r3(n).toFixed(3);
}

function httpErr(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function cleanMotivo(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 255) : null;
}

function assertScope(branchId, actor) {
  if (actor.isSuperAdmin) return;
  const allowed = (actor.allowedBranchIds || []).map((x) => toInt(x, 0));
  if (!allowed.includes(toInt(branchId, 0))) {
    throw httpErr(403, "FORBIDDEN_BRANCH", "No podés operar sobre depósitos de otra sucursal.");
  }
}

/**
 * Valida y agrupa items: [{ product_id, counted_qty }].
 * Un producto repetido en el mismo cuerpo se suma.
 * allowNegative: en modo "sumar" se acepta un delta negativo (restar una lectura).
 */
function normalizeItems(items, { allowNegative = false } = {}) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw httpErr(400, "ITEMS_INVALID", "items debe ser una lista");

  const map = new Map();
  for (const it of items) {
    const product_id = toInt(it?.product_id, 0);
    if (!product_id) throw httpErr(400, "PRODUCT_REQUIRED", "product_id requerido en cada ítem");
    const q = toNum(it?.counted_qty);
    if (!Number.isFinite(q) || (!allowNegative && q < 0)) {
      throw httpErr(400, "QTY_INVALID", "counted_qty inválido (número >= 0)", { product_id });
    }
    map.set(product_id, r3((map.get(product_id) || 0) + q));
  }
  return [...map.entries()].map(([product_id, counted_qty]) => ({ product_id, counted_qty }));
}

async function validateProducts(productIds, t) {
  if (!productIds.length) return;
  const rows = await Product.findAll({
    where: { id: { [Op.in]: productIds } },
    attributes: ["id", "track_stock"],
    transaction: t,
  });
  const map = new Map(rows.map((p) => [toInt(p.id), p]));
  for (const id of productIds) {
    const p = map.get(id);
    if (!p) throw httpErr(404, "PRODUCT_NOT_FOUND", `Producto #${id} no encontrado`, { product_id: id });
    if (p.track_stock === false || p.track_stock === 0) {
      throw httpErr(422, "PRODUCT_NO_STOCK_TRACK", `El producto #${id} no lleva control de stock`, { product_id: id });
    }
  }
}

/**
 * Carga renglones. Upsert sobre UNIQUE (count_id, product_id): dos teléfonos
 * sumando a la vez no se pisan.
 */
async function upsertItems(countId, items, mode, userId, t) {
  const sumar = mode === "sumar";
  for (const it of items) {
    await sequelize.query(
      `INSERT INTO stock_count_items (count_id, product_id, counted_qty, updated_by)
       VALUES (:countId, :productId, :q, :userId)
       ON DUPLICATE KEY UPDATE
         counted_qty = ${sumar ? "counted_qty + :q" : ":q"},
         updated_by  = :userId`,
      {
        replacements: { countId, productId: it.product_id, q: it.counted_qty, userId: userId || null },
        transaction: t,
      }
    );
  }

  if (sumar && items.length) {
    const [neg] = await sequelize.query(
      `SELECT product_id FROM stock_count_items
        WHERE count_id = :countId AND product_id IN (:ids) AND counted_qty < 0
        LIMIT 1`,
      { replacements: { countId, ids: items.map((i) => i.product_id) }, type: QueryTypes.SELECT, transaction: t }
    );
    if (neg) {
      throw httpErr(400, "QTY_INVALID", "La cantidad contada no puede quedar negativa", { product_id: toInt(neg.product_id) });
    }
  }
}

async function lockCount(id, t) {
  const count = await StockCount.findByPk(toInt(id, 0), { transaction: t, lock: t.LOCK.UPDATE });
  if (!count) throw httpErr(404, "NOT_FOUND", "Conteo no encontrado");
  return count;
}

async function resolveMotivo(count, bodyMotivo) {
  const m = cleanMotivo(bodyMotivo);
  const motivo = m !== undefined && m !== null ? m : count.motivo;
  if (!motivo) throw httpErr(400, "MOTIVO_REQUIRED", "Falta el motivo del conteo");
  return motivo;
}

async function itemsCount(countId, t) {
  const [row] = await sequelize.query(
    "SELECT COUNT(*) AS n FROM stock_count_items WHERE count_id = :countId",
    { replacements: { countId }, type: QueryTypes.SELECT, transaction: t }
  );
  return toInt(row?.n, 0);
}

// ─── GET BY ID ──────────────────────────────────────────────────────────────
const HEADER_INCLUDES = [
  { model: Warehouse, as: "warehouse", attributes: ["id", "name", "branch_id"],
    include: [{ model: Branch, as: "branch", attributes: ["id", "name"] }] },
  { model: User, as: "creator",   attributes: ["id", "first_name", "last_name"] },
  { model: User, as: "submitter", attributes: ["id", "first_name", "last_name"] },
  { model: User, as: "applier",   attributes: ["id", "first_name", "last_name"] },
];

/**
 * Conteo con renglones. Abierto: system_qty = stock actual del depósito.
 * Aplicado: system_qty congelado al aplicar.
 */
async function getCountById(id, actor, transaction) {
  const count = await StockCount.findByPk(toInt(id, 0), {
    include: [
      ...HEADER_INCLUDES,
      {
        model: StockCountItem,
        as: "items",
        include: [{
          model: Product,
          as: "product",
          // category_id / subcategory_id: el filtro Rubro del conteo en el teléfono.
          attributes: ["id", "name", "sku", "barcode", "code", "is_active", "category_id", "subcategory_id"],
          include: [{ model: ProductImage, as: "images", attributes: ["url", "sort_order"] }],
        }],
      },
    ],
    order: [[{ model: StockCountItem, as: "items" }, "updated_at", "DESC"]],
    transaction,
  });
  if (!count) throw httpErr(404, "NOT_FOUND", "Conteo no encontrado");
  if (actor) assertScope(count.branch_id, actor);

  const json = count.toJSON();
  const open = OPEN.includes(json.status);

  let live = new Map();
  if (open && json.items?.length) {
    const rows = await sequelize.query(
      `SELECT product_id, qty FROM stock_balances
        WHERE warehouse_id = :wh AND product_id IN (:ids)`,
      {
        replacements: { wh: json.warehouse_id, ids: json.items.map((i) => i.product_id) },
        type: QueryTypes.SELECT,
        transaction,
      }
    );
    live = new Map(rows.map((r) => [toInt(r.product_id), Number(r.qty) || 0]));
  }

  let withDiff = 0;
  json.items = (json.items || []).map((it) => {
    const counted = Number(it.counted_qty) || 0;
    const system = open ? (live.get(toInt(it.product_id)) || 0) : Number(it.system_qty) || 0;
    const diff = open ? r3(counted - system) : Number(it.diff_qty) || 0;
    if (diff !== 0) withDiff++;
    const images = (it.product?.images || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).slice(0, 1);
    return {
      id: it.id,
      product_id: it.product_id,
      counted_qty: fmt(counted),
      system_qty: fmt(system),
      diff_qty: fmt(diff),
      updated_by: it.updated_by,
      updated_at: it.updated_at,
      product: it.product ? { ...it.product, images } : null,
    };
  });
  json.summary = { items: json.items.length, with_diff: withDiff, equal: json.items.length - withDiff };
  return json;
}

// ─── CREATE ─────────────────────────────────────────────────────────────────
async function createCount({ warehouse_id, motivo, items }, actor) {
  const whId = toInt(warehouse_id, 0);
  if (!whId) throw httpErr(400, "WAREHOUSE_REQUIRED", "Depósito requerido");
  const wh = await Warehouse.findByPk(whId, { attributes: ["id", "branch_id"] });
  if (!wh) throw httpErr(404, "WAREHOUSE_NOT_FOUND", "Depósito no encontrado");
  assertScope(wh.branch_id, actor);

  const rows = normalizeItems(items);

  const id = await sequelize.transaction(async (t) => {
    await validateProducts(rows.map((r) => r.product_id), t);

    // Número definitivo a partir del id: sin carrera entre dos altas simultáneas.
    const tmp = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const count = await StockCount.create({
      number: tmp,
      warehouse_id: wh.id,
      branch_id: wh.branch_id,
      status: "draft",
      motivo: cleanMotivo(motivo) ?? null,
      created_by: actor.userId,
    }, { transaction: t });

    const year = new Date().getFullYear();
    await count.update({ number: `CON-${year}-${String(count.id).padStart(6, "0")}` }, { transaction: t });

    await upsertItems(count.id, rows, "reemplazar", actor.userId, t);
    return count.id;
  });

  return getCountById(id, null);
}

// ─── UPDATE (cargar cantidades) ─────────────────────────────────────────────
async function updateCount(id, { mode, items, remove_product_ids, motivo }, actor) {
  const m = mode === undefined || mode === null || mode === "" ? "reemplazar" : String(mode);
  if (!MODES.includes(m)) throw httpErr(400, "MODE_INVALID", `mode inválido (${MODES.join(", ")})`);

  const rows = normalizeItems(items, { allowNegative: m === "sumar" });
  const removeIds = Array.isArray(remove_product_ids)
    ? [...new Set(remove_product_ids.map((x) => toInt(x, 0)).filter(Boolean))]
    : [];

  await sequelize.transaction(async (t) => {
    const count = await lockCount(id, t);
    assertScope(count.branch_id, actor);

    if (!OPEN.includes(count.status)) {
      throw httpErr(422, "COUNT_NOT_OPEN", "El conteo ya no se puede modificar");
    }
    if (count.status === "pending" && !actor.isAdmin) {
      throw httpErr(403, "FORBIDDEN", "El conteo ya se envió para aprobar: sólo un administrador lo corrige.");
    }

    await validateProducts(rows.map((r) => r.product_id), t);

    if (m === "reemplazar_todo") {
      const keep = rows.map((r) => r.product_id);
      await StockCountItem.destroy({
        where: keep.length ? { count_id: count.id, product_id: { [Op.notIn]: keep } } : { count_id: count.id },
        transaction: t,
      });
    }

    await upsertItems(count.id, rows, m === "sumar" ? "sumar" : "reemplazar", actor.userId, t);

    if (removeIds.length) {
      await StockCountItem.destroy({ where: { count_id: count.id, product_id: { [Op.in]: removeIds } }, transaction: t });
    }

    const newMotivo = cleanMotivo(motivo);
    if (newMotivo !== undefined) count.motivo = newMotivo;
    count.changed("updated_at", true);
    await count.save({ transaction: t });
  });

  return getCountById(id, null);
}

// ─── SUBMIT (cajero -> pendiente de aprobación) ─────────────────────────────
async function submitCount(id, { motivo } = {}, actor) {
  await sequelize.transaction(async (t) => {
    const count = await lockCount(id, t);
    assertScope(count.branch_id, actor);
    if (count.status !== "draft") {
      throw httpErr(422, "COUNT_NOT_OPEN", "Sólo se envía un conteo en borrador");
    }
    if (!(await itemsCount(count.id, t))) throw httpErr(422, "COUNT_EMPTY", "El conteo no tiene productos");
    const m = await resolveMotivo(count, motivo);

    await count.update({
      status: "pending",
      motivo: m,
      submitted_by: actor.userId,
      submitted_at: new Date(),
    }, { transaction: t });
  });

  const json = await getCountById(id, null);

  // Aviso push al dueño y al administrador de la sucursal
  // (services/avisosPush.service.js). Post-commit y sin await: el envío del
  // conteo no espera ni falla por el aviso.
  try {
    require("./avisosPush.service")
      .avisarConteoEnviado({
        id: json.id,
        number: json.number,
        branch_id: json.branch_id,
        sucursal: json.warehouse?.branch?.name || json.warehouse?.name || "",
        productos: json.summary?.items || 0,
        con_diferencia: json.summary?.with_diff || 0,
      })
      .catch(() => {});
  } catch (_) {}

  return json;
}

// ─── APPLY (administrador) ──────────────────────────────────────────────────
/**
 * En una transacción: fija cada cantidad contada (valor absoluto, como
 * /stock/init), congela system_qty y diff_qty y registra un movimiento
 * `adjustment` por cada diferencia (ref_type "stock_count").
 * No usa createStockMovement porque abre su propia transacción y aquí todo
 * tiene que ser una sola; sigue el patrón de stockTransfer.dispatchTransfer.
 */
async function applyCount(id, { motivo } = {}, actor) {
  if (!actor.isAdmin) {
    throw httpErr(403, "FORBIDDEN", "Solo administradores pueden aplicar un conteo.");
  }

  const changes = [];
  const movementIds = [];

  await sequelize.transaction(async (t) => {
    const count = await lockCount(id, t);
    assertScope(count.branch_id, actor);
    if (!OPEN.includes(count.status)) {
      throw httpErr(422, "COUNT_NOT_OPEN", "El conteo ya fue aplicado o cancelado");
    }

    const items = await StockCountItem.findAll({
      where: { count_id: count.id },
      order: [["product_id", "ASC"]], // orden fijo de bloqueos: evita deadlocks
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!items.length) throw httpErr(422, "COUNT_EMPTY", "El conteo no tiene productos");
    const m = await resolveMotivo(count, motivo);

    for (const it of items) {
      const counted = r3(Number(it.counted_qty) || 0);

      const [bal] = await sequelize.query(
        `SELECT qty FROM stock_balances
          WHERE warehouse_id = :wh AND product_id = :prod
          FOR UPDATE`,
        { replacements: { wh: count.warehouse_id, prod: it.product_id }, type: QueryTypes.SELECT, transaction: t }
      );
      const system = r3(Number(bal?.qty) || 0);
      const diff = r3(counted - system);

      await sequelize.query(
        `INSERT INTO stock_balances (warehouse_id, product_id, qty)
         VALUES (:wh, :prod, :qty)
         ON DUPLICATE KEY UPDATE qty = :qty`,
        { replacements: { wh: count.warehouse_id, prod: it.product_id, qty: counted }, transaction: t }
      );

      await it.update({ system_qty: system, diff_qty: diff }, { transaction: t });

      if (diff !== 0) {
        const sign = diff > 0 ? "+" : "";
        const note = `${count.number} · ${m} · ${fmtShort(system)} -> ${fmtShort(counted)} (${sign}${fmtShort(diff)})`.slice(0, 255);
        const movement = await StockMovement.create({
          type: "adjustment",
          warehouse_id: count.warehouse_id,
          ref_type: "stock_count",
          ref_id: String(count.id),
          note,
          created_by: actor.userId,
        }, { transaction: t });
        await StockMovementItem.create({
          movement_id: movement.id,
          product_id: it.product_id,
          qty: Math.abs(diff), // la tabla guarda cantidades positivas; el signo queda en diff_qty y en la nota
        }, { transaction: t });
        movementIds.push(movement.id);
        changes.push({ product_id: it.product_id, prev: system, next: counted, delta: diff });
      }

      if (counted > 0) {
        // Igual que la recepción de derivaciones: si hay stock, el producto queda habilitado en la sucursal.
        await sequelize.query(
          `INSERT IGNORE INTO product_branches (product_id, branch_id, is_active, created_at)
           VALUES (:prod, :branch, 1, NOW())`,
          { replacements: { prod: it.product_id, branch: count.branch_id }, transaction: t }
        );
      }
    }

    await count.update({
      status: "applied",
      motivo: m,
      applied_by: actor.userId,
      applied_at: new Date(),
    }, { transaction: t });

    // Avisos de stock (Telegram) sólo si la transacción se confirma.
    t.afterCommit(() => {
      try {
        const tg = require("./telegramNotifier.service");
        for (const c of changes) {
          tg.notifyStockChange({ ...c, warehouse_id: count.warehouse_id, source: "stock_count" }).catch(() => {});
        }
      } catch (_) {
        // El notificador es opcional.
      }
    });
  });

  const count = await getCountById(id, null);
  return { count, movements: movementIds, summary: count.summary };
}

function fmtShort(n) {
  return String(r3(n));
}

// ─── CANCEL ─────────────────────────────────────────────────────────────────
async function cancelCount(id, actor) {
  await sequelize.transaction(async (t) => {
    const count = await lockCount(id, t);
    assertScope(count.branch_id, actor);
    if (!OPEN.includes(count.status)) {
      throw httpErr(422, "COUNT_NOT_OPEN", "El conteo ya fue aplicado o cancelado");
    }
    if (!actor.isAdmin && toInt(count.created_by) !== toInt(actor.userId)) {
      throw httpErr(403, "FORBIDDEN", "Sólo quien lo creó o un administrador puede cancelar el conteo.");
    }
    await count.update({
      status: "cancelled",
      cancelled_by: actor.userId,
      cancelled_at: new Date(),
    }, { transaction: t });
  });
  return getCountById(id, null);
}

// ─── LIST ───────────────────────────────────────────────────────────────────
// Ámbito: super_admin ve todo; el resto, los conteos de sus sucursales
// habilitadas (todos los de la sucursal, para contar entre dos).
async function listCounts({ status, warehouse_id, page = 1, limit = 20 }, actor) {
  const cleanLimit = Math.min(50, Math.max(1, toInt(limit, 20)));
  const cleanPage = Math.max(1, toInt(page, 1));

  const scopeWhere = {};
  if (!actor.isSuperAdmin) {
    const allowed = (actor.allowedBranchIds || []).map((x) => toInt(x, 0)).filter(Boolean);
    if (!allowed.length) {
      return { counts: [], total: 0, total_all: 0, count_by_status: {}, page: cleanPage, limit: cleanLimit };
    }
    scopeWhere.branch_id = { [Op.in]: allowed };
  }
  const whId = toInt(warehouse_id, 0);
  if (whId) scopeWhere.warehouse_id = whId;

  const where = { ...scopeWhere };
  const statuses = String(status || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => STATUSES.includes(s));
  if (statuses.length) where.status = { [Op.in]: statuses };

  const [result, statusRows] = await Promise.all([
    StockCount.findAndCountAll({
      where,
      include: HEADER_INCLUDES,
      attributes: {
        include: [[
          sequelize.literal("(SELECT COUNT(*) FROM stock_count_items sci WHERE sci.count_id = `StockCount`.`id`)"),
          "items_count",
        ]],
      },
      order: [["updated_at", "DESC"], ["id", "DESC"]],
      limit: cleanLimit,
      offset: (cleanPage - 1) * cleanLimit,
      distinct: true,
    }),
    StockCount.findAll({
      where: scopeWhere,
      attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "cnt"]],
      group: ["status"],
      raw: true,
    }),
  ]);

  const count_by_status = {};
  for (const r of statusRows || []) count_by_status[String(r.status)] = toInt(r.cnt, 0);
  const total_all = Object.values(count_by_status).reduce((a, b) => a + b, 0);

  return {
    counts: result.rows.map((r) => {
      const j = r.toJSON();
      j.items_count = toInt(j.items_count, 0);
      return j;
    }),
    total: result.count,
    total_all,
    count_by_status,
    page: cleanPage,
    limit: cleanLimit,
  };
}

module.exports = {
  createCount, updateCount, submitCount, applyCount, cancelCount,
  listCounts, getCountById,
};
