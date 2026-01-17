// ✅ COPY-PASTE FINAL COMPLETO (alineado a tu código actual)
// src/controllers/stock.controller.js
//
// Mantiene:
// - GET /stock?warehouse_id=...
// - Movimientos (createMovement / listMovements)
// Mejora:
// - initStock: acepta warehouse_id O branch_id (si no hay warehouse_id lo resuelve por branch)
// - initStock: SET ABSOLUTO (idempotente) con lock FOR UPDATE
// - Validaciones claras + mensajes consistentes
// - No rompe tu estructura de modelos/servicios existente

const { Op } = require("sequelize");
const {
  StockBalance,
  Product,
  Warehouse,
  Branch,
  StockMovement,
  StockMovementItem,
} = require("../models");
const { createStockMovement } = require("../services/stock.service");

// =====================
// Helpers
// =====================
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function toNum(v, d = 0) {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : d;
}

async function resolveWarehouseId({ warehouse_id, branch_id }, { transaction } = {}) {
  const wid = toInt(warehouse_id, 0);
  if (wid > 0) return wid;

  const bid = toInt(branch_id, 0);
  if (!bid) return 0;

  // ✅ Default: primer depósito de esa sucursal (id ASC)
  const wh = await Warehouse.findOne({
    where: { branch_id: bid },
    order: [["id", "ASC"]],
    transaction,
  });

  return toInt(wh?.id, 0);
}

// =====================
// GET STOCK
// =====================
exports.getStock = async (req, res) => {
  try {
    const warehouse_id = toInt(req.query.warehouse_id, 0);
    if (!warehouse_id) {
      return res.status(400).json({ ok: false, code: "WAREHOUSE_REQUIRED", message: "warehouse_id requerido" });
    }

    const q = String(req.query.q || "").trim();
    const whereProduct = {};

    if (q) {
      whereProduct[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { sku: { [Op.like]: `%${q}%` } },
        { barcode: { [Op.like]: `%${q}%` } },
        { brand: { [Op.like]: `%${q}%` } },
        { model: { [Op.like]: `%${q}%` } },
      ];
    }

    const items = await StockBalance.findAll({
      where: { warehouse_id },
      include: [
        {
          model: Product,
          as: "product",
          where: q ? whereProduct : undefined,
          required: !!q,
          attributes: ["id", "sku", "barcode", "name", "brand", "model"],
        },
        {
          model: Warehouse,
          as: "warehouse",
          include: [{ model: Branch, as: "branch", attributes: ["id", "name"] }],
        },
      ],
      order: [["product_id", "ASC"]],
    });

    return res.json({ ok: true, warehouse_id, items });
  } catch (e) {
    return res.status(500).json({ ok: false, code: "STOCK_GET_ERROR", message: e.message });
  }
};

// =====================
// STOCK INIT (✅ SET ABSOLUTO, REAL por sucursal)
// =====================
// Acepta:
// - product_id (required)
// - qty (required, >= 0)
// - warehouse_id (opcional)
// - branch_id (opcional) -> si no hay warehouse_id, resuelve depósito default de esa sucursal
//
// Comportamiento:
// - qty = X (NO suma). Es idempotente.
// - lock FOR UPDATE para evitar carreras
exports.initStock = async (req, res) => {
  const t = await StockBalance.sequelize.transaction();
  try {
    const product_id = toInt(req.body?.product_id, 0);
    const branch_id = toInt(req.body?.branch_id, 0);
    const qty = toNum(req.body?.qty, NaN);
    let warehouse_id = toInt(req.body?.warehouse_id, 0);

    if (!product_id) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "PRODUCT_REQUIRED", message: "product_id requerido" });
    }

    if (!Number.isFinite(qty) || qty < 0) {
      await t.rollback();
      return res.status(400).json({ ok: false, code: "QTY_INVALID", message: "qty inválido (>= 0)" });
    }

    // ✅ Debe venir al menos branch_id o warehouse_id
    if (!warehouse_id && !branch_id) {
      await t.rollback();
      return res.status(400).json({
        ok: false,
        code: "BRANCH_OR_WAREHOUSE_REQUIRED",
        message: "Debe venir branch_id o warehouse_id.",
      });
    }

    const product = await Product.findByPk(product_id, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado" });
    }

    // ✅ Resolver warehouse si no vino
    if (!warehouse_id) {
      warehouse_id = await resolveWarehouseId({ warehouse_id: 0, branch_id }, { transaction: t });
      if (!warehouse_id) {
        await t.rollback();
        return res.status(400).json({
          ok: false,
          code: "WAREHOUSE_NOT_FOUND",
          message: "No se encontró depósito para esa sucursal (branch_id).",
        });
      }
    } else {
      // Validar warehouse exista
      const wh = await Warehouse.findByPk(warehouse_id, { transaction: t });
      if (!wh) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "WAREHOUSE_NOT_FOUND", message: "Depósito no encontrado" });
      }
    }

    const where = { warehouse_id, product_id };

    // ✅ Lock fila (si existe)
    const row = await StockBalance.findOne({
      where,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let action = "CREATED";

    if (!row) {
      await StockBalance.create({ ...where, qty }, { transaction: t });
    } else {
      row.qty = qty; // ✅ SET ABSOLUTO
      await row.save({ transaction: t });
      action = "UPDATED";
    }

    await t.commit();
    return res.json({
      ok: true,
      message: "Stock aplicado",
      data: { action, product_id, branch_id: branch_id || null, warehouse_id, qty },
    });
  } catch (e) {
    await t.rollback();
    return res.status(400).json({
      ok: false,
      code: e?.code || e?.message || "INIT_STOCK_ERROR",
      message: e?.message || "Error initStock",
    });
  }
};

// =====================
// MOVIMIENTOS
// =====================
exports.createMovement = async (req, res) => {
  try {
    const userId = req.user?.sub || req.user?.id || null;
    const movement = await createStockMovement(req.body || {}, userId);

    const full = await StockMovement.findByPk(movement.id, {
      include: [
        {
          model: StockMovementItem,
          as: "items",
          include: [{ model: Product, as: "product", attributes: ["id", "sku", "name"] }],
        },
      ],
    });

    return res.status(201).json({ ok: true, movement: full });
  } catch (e) {
    return res.status(400).json({ ok: false, code: e.code || "MOVEMENT_ERROR", message: e.message });
  }
};

exports.listMovements = async (req, res) => {
  try {
    const warehouse_id = req.query.warehouse_id ? toInt(req.query.warehouse_id, 0) : null;

    const where = {};
    if (warehouse_id) where.warehouse_id = warehouse_id;

    const items = await StockMovement.findAll({
      where,
      include: [{ model: StockMovementItem, as: "items" }],
      order: [["id", "DESC"]],
      limit: 200,
    });

    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ ok: false, code: "MOVEMENTS_LIST_ERROR", message: e.message });
  }
};
