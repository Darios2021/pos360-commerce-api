const { Op } = require("sequelize");
const {
  sequelize,
  Product,
  StockBalance,
  StockMovement,
  StockMovementItem,
} = require("../models");

function toNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return x;
}

async function getBalance(warehouse_id, product_id, t) {
  const [row] = await StockBalance.findOrCreate({
    where: { warehouse_id, product_id },
    defaults: { qty: 0 },
    transaction: t,
  });
  return row;
}

async function addQty(warehouse_id, product_id, delta, t) {
  const bal = await getBalance(warehouse_id, product_id, t);
  const current = toNumber(bal.qty);
  const next = current + toNumber(delta);
  bal.qty = next;
  await bal.save({ transaction: t });
  return bal;
}

async function ensureStock(warehouse_id, product_id, needed, t) {
  const bal = await getBalance(warehouse_id, product_id, t);
  const current = toNumber(bal.qty);
  if (current < toNumber(needed)) {
    throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
      code: "INSUFFICIENT_STOCK",
      warehouse_id,
      product_id,
      current,
      needed,
    });
  }
}

async function applyMovement({ type, warehouse_id, from_warehouse_id, to_warehouse_id, items }, t) {
  // items: [{ product_id, qty, unit_cost? }]
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("NO_ITEMS"), { code: "NO_ITEMS" });
  }

  // validar productos y track_stock
  const productIds = [...new Set(items.map((i) => Number(i.product_id)))];
  const products = await Product.findAll({
    where: { id: { [Op.in]: productIds } },
    transaction: t,
  });
  const map = new Map(products.map((p) => [Number(p.id), p]));
  for (const it of items) {
    const p = map.get(Number(it.product_id));
    if (!p) throw Object.assign(new Error("PRODUCT_NOT_FOUND"), { code: "PRODUCT_NOT_FOUND", product_id: it.product_id });
    if (!p.track_stock) {
      throw Object.assign(new Error("PRODUCT_NO_STOCK_TRACK"), { code: "PRODUCT_NO_STOCK_TRACK", product_id: it.product_id });
    }
    if (toNumber(it.qty) <= 0) {
      throw Object.assign(new Error("INVALID_QTY"), { code: "INVALID_QTY", product_id: it.product_id });
    }
  }

  if (type === "in") {
    if (!warehouse_id) throw Object.assign(new Error("WAREHOUSE_REQUIRED"), { code: "WAREHOUSE_REQUIRED" });
    for (const it of items) {
      await addQty(warehouse_id, it.product_id, +toNumber(it.qty), t);
    }
  }

  if (type === "out") {
    if (!warehouse_id) throw Object.assign(new Error("WAREHOUSE_REQUIRED"), { code: "WAREHOUSE_REQUIRED" });
    for (const it of items) {
      await ensureStock(warehouse_id, it.product_id, toNumber(it.qty), t);
    }
    for (const it of items) {
      await addQty(warehouse_id, it.product_id, -toNumber(it.qty), t);
    }
  }

  if (type === "adjustment") {
    // Para ajustes: interpretamos qty como DELTA (puede ser positivo o negativo)
    // Para Adminer SQL definimos positivo, pero a nivel API permitimos ajuste +/- usando qty_signed.
    // Si mandás qty positivo y querés bajar stock, mandá type=out. Si querés ajuste negativo, mandalo como qty_signed.
    // Implementación:
    // - si item.qty_signed existe, usa ese (puede ser negativo)
    // - si no existe, usa qty como positivo (suma)
    if (!warehouse_id) throw Object.assign(new Error("WAREHOUSE_REQUIRED"), { code: "WAREHOUSE_REQUIRED" });

    for (const it of items) {
      const delta = it.qty_signed !== undefined ? toNumber(it.qty_signed) : +toNumber(it.qty);
      if (!Number.isFinite(delta) || delta === 0) {
        throw Object.assign(new Error("INVALID_ADJUSTMENT_QTY"), { code: "INVALID_ADJUSTMENT_QTY", product_id: it.product_id });
      }
      if (delta < 0) {
        await ensureStock(warehouse_id, it.product_id, Math.abs(delta), t);
      }
    }

    for (const it of items) {
      const delta = it.qty_signed !== undefined ? toNumber(it.qty_signed) : +toNumber(it.qty);
      await addQty(warehouse_id, it.product_id, delta, t);
    }
  }

  if (type === "transfer") {
    if (!from_warehouse_id || !to_warehouse_id) {
      throw Object.assign(new Error("TRANSFER_WAREHOUSES_REQUIRED"), { code: "TRANSFER_WAREHOUSES_REQUIRED" });
    }
    if (Number(from_warehouse_id) === Number(to_warehouse_id)) {
      throw Object.assign(new Error("TRANSFER_SAME_WAREHOUSE"), { code: "TRANSFER_SAME_WAREHOUSE" });
    }
    for (const it of items) {
      await ensureStock(from_warehouse_id, it.product_id, toNumber(it.qty), t);
    }
    for (const it of items) {
      await addQty(from_warehouse_id, it.product_id, -toNumber(it.qty), t);
      await addQty(to_warehouse_id, it.product_id, +toNumber(it.qty), t);
    }
  }
}

async function createStockMovement(payload, userId) {
  return sequelize.transaction(async (t) => {
    const {
      type,
      warehouse_id = null,
      from_warehouse_id = null,
      to_warehouse_id = null,
      ref_type = null,
      ref_id = null,
      note = null,
      items = [],
    } = payload;

    const movement = await StockMovement.create(
      {
        type,
        warehouse_id,
        from_warehouse_id,
        to_warehouse_id,
        ref_type,
        ref_id,
        note,
        created_by: userId ? Number(userId) : null,
      },
      { transaction: t }
    );

    // Guardamos items (guardamos qty positivo siempre)
    const itemsRows = items.map((it) => ({
      movement_id: movement.id,
      product_id: Number(it.product_id),
      qty: Math.abs(toNumber(it.qty || it.qty_signed || 0)),
      unit_cost: it.unit_cost ?? null,
    }));

    await StockMovementItem.bulkCreate(itemsRows, { transaction: t });

    // Aplicamos a balances
    await applyMovement(
      {
        type,
        warehouse_id,
        from_warehouse_id,
        to_warehouse_id,
        items,
      },
      t
    );

    return movement;
  });
}

module.exports = {
  createStockMovement,
};
