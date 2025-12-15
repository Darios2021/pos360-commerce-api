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
        required: q ? true : false,
        attributes: ["id", "sku", "barcode", "name", "brand", "model", "track_stock", "is_active"],
      },
      {
        model: Warehouse,
        as: "warehouse",
        include: [{ model: Branch, as: "branch", attributes: ["id", "code", "name"] }],
        attributes: ["id", "code", "name", "branch_id"],
      },
    ],
    order: [["product_id", "ASC"]],
  });

  res.json({ ok: true, warehouse_id, items });
};

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
    if (e.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({ ok: false, code: e.code, details: {
        warehouse_id: e.warehouse_id,
        product_id: e.product_id,
        current: e.current,
        needed: e.needed,
      }});
    }
    return res.status(400).json({ ok: false, code: e.code || "MOVEMENT_ERROR", message: e.message });
  }
};

exports.listMovements = async (req, res) => {
  const warehouse_id = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;

  const where = {};
  if (warehouse_id) where[Op.or] = [
    { warehouse_id },
    { from_warehouse_id: warehouse_id },
    { to_warehouse_id: warehouse_id },
  ];

  const items = await StockMovement.findAll({
    where,
    include: [{ model: StockMovementItem, as: "items" }],
    order: [["id", "DESC"]],
    limit: 200,
  });

  res.json({ ok: true, items });
};
