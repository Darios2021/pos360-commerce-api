// src/controllers/stock.controller.js
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
// GET STOCK
// =====================
exports.getStock = async (req, res) => {
  const warehouse_id = Number(req.query.warehouse_id || 0);
  if (!warehouse_id) {
    return res.status(400).json({ ok: false, code: "WAREHOUSE_REQUIRED" });
  }

  const q = (req.query.q || "").trim();
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

  res.json({ ok: true, warehouse_id, items });
};

// =====================
// STOCK INIT (🔥 FIX FINAL)
// =====================
exports.initStock = async (req, res) => {
  const t = await StockBalance.sequelize.transaction();
  try {
    const product_id = Number(req.body?.product_id || 0);
    const branch_id = Number(req.body?.branch_id || 0);
    const qty = Number(req.body?.qty ?? 0);
    let warehouse_id = Number(req.body?.warehouse_id || 0);

    if (!product_id) throw new Error("PRODUCT_REQUIRED");
    if (!branch_id) throw new Error("BRANCH_REQUIRED");
    if (!Number.isFinite(qty) || qty < 0) throw new Error("QTY_INVALID");

    const product = await Product.findByPk(product_id, { transaction: t });
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    if (!warehouse_id) {
      const wh = await Warehouse.findOne({
        where: { branch_id },
        order: [["id", "ASC"]],
        transaction: t,
      });
      if (!wh) throw new Error("WAREHOUSE_NOT_FOUND");
      warehouse_id = wh.id;
    }

    const where = { warehouse_id, product_id };
    const row = await StockBalance.findOne({
      where,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let action = "CREATED";
    if (!row) {
      await StockBalance.create({ ...where, qty }, { transaction: t });
    } else {
      row.qty = qty;
      await row.save({ transaction: t });
      action = "UPDATED";
    }

    await t.commit();
    return res.json({
      ok: true,
      message: "Stock inicial asignado",
      data: { action, product_id, branch_id, warehouse_id, qty },
    });
  } catch (e) {
    await t.rollback();
    return res.status(400).json({
      ok: false,
      code: e.message,
      message: e.message,
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

    res.status(201).json({ ok: true, movement: full });
  } catch (e) {
    return res.status(400).json({ ok: false, code: e.code || "MOVEMENT_ERROR", message: e.message });
  }
};

exports.listMovements = async (req, res) => {
  const warehouse_id = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;

  const where = {};
  if (warehouse_id) where.warehouse_id = warehouse_id;

  const items = await StockMovement.findAll({
    where,
    include: [{ model: StockMovementItem, as: "items" }],
    order: [["id", "DESC"]],
    limit: 200,
  });

  res.json({ ok: true, items });
};
