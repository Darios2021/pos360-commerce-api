// src/modules/pos/pos.controller.js
const { initPosModels } = require("./pos.models");
const { createPosSale } = require("./pos.service");

function ok(res, data) {
  return res.json({ ok: true, ...data });
}

function fail(res, err) {
  const status = err?.status || 500;
  return res.status(status).json({
    ok: false,
    message: err?.message || "Error",
  });
}

async function createSale(req, res) {
  try {
    const result = await createPosSale(req.body, req.user);
    return ok(res, result);
  } catch (err) {
    return fail(res, err);
  }
}

async function listSales(req, res) {
  try {
    const { Sale } = initPosModels();
    const { branch_id, status, q, from, to, limit, offset } = req.query;

    const where = {};
    if (branch_id) where.branch_id = branch_id;
    if (status) where.status = status;

    // filtro simple por rango fecha
    const whereDate = {};
    if (from) whereDate.$gte = new Date(from);
    if (to) whereDate.$lte = new Date(to);

    // Usamos query raw simple para no depender de Op si no lo tenés importado en tu stack
    // Si querés, lo paso a Sequelize Op en una segunda vuelta.
    // Por ahora: listado básico.
    const rows = await Sale.findAll({
      order: [["id", "DESC"]],
      limit: Number(limit ?? 50),
      offset: Number(offset ?? 0),
    });

    // filtro q básico sobre sale_number/customer_name (sin Op) => lo hacemos en memoria MVP
    let filtered = rows;
    if (branch_id) filtered = filtered.filter((r) => String(r.branch_id) === String(branch_id));
    if (status) filtered = filtered.filter((r) => String(r.status) === String(status));
    if (from) filtered = filtered.filter((r) => new Date(r.sold_at) >= new Date(from));
    if (to) filtered = filtered.filter((r) => new Date(r.sold_at) <= new Date(to));
    if (q) {
      const qq = String(q).toLowerCase();
      filtered = filtered.filter((r) => {
        return (
          String(r.sale_number ?? "").toLowerCase().includes(qq) ||
          String(r.customer_name ?? "").toLowerCase().includes(qq) ||
          String(r.customer_doc ?? "").toLowerCase().includes(qq) ||
          String(r.customer_phone ?? "").toLowerCase().includes(qq)
        );
      });
    }

    return ok(res, { rows: filtered });
  } catch (err) {
    return fail(res, err);
  }
}

async function getSale(req, res) {
  try {
    const { Sale } = initPosModels();
    const id = req.params.id;

    const sale = await Sale.findByPk(id, {
      include: [{ association: "items" }, { association: "payments" }],
    });

    if (!sale) return res.status(404).json({ ok: false, message: "Sale not found" });
    return ok(res, { sale });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = {
  createSale,
  listSales,
  getSale,
};
