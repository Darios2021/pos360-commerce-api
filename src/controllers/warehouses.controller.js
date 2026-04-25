const { Op } = require("sequelize");
const { Warehouse, Branch } = require("../models");
const access = require("../utils/accessScope");

exports.list = async (req, res) => {
  // SCOPE
  //   - super_admin: ve TODOS los depósitos. Puede filtrar con ?branch_id=
  //   - branch admin / cajero: solo depósitos de sus sucursales habilitadas.
  const branchIdQuery = req.query.branch_id ? Number(req.query.branch_id) : null;
  const where = {};

  if (access.isSuperAdmin(req)) {
    if (branchIdQuery) where.branch_id = branchIdQuery;
  } else {
    const allowed = access.getAllowedBranchIds(req);
    if (!allowed.length) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar la sucursal del usuario.",
      });
    }
    // Si el query branch_id no está en allowed, lo ignoramos.
    if (branchIdQuery && allowed.includes(branchIdQuery)) {
      where.branch_id = branchIdQuery;
    } else if (allowed.length === 1) {
      where.branch_id = allowed[0];
    } else {
      where.branch_id = { [Op.in]: allowed };
    }
  }

  const items = await Warehouse.findAll({
    where,
    include: [{ model: Branch, as: "branch", attributes: ["id", "code", "name"] }],
    order: [["id", "DESC"]],
  });

  res.json({ ok: true, items });
};

exports.create = async (req, res) => {
  const body = req.body || {};
  if (!body.branch_id || !body.code || !body.name) {
    return res.status(400).json({ ok: false, code: "VALIDATION", message: "branch_id, code y name son obligatorios" });
  }

  // SCOPE de creación:
  //   - super_admin: cualquier sucursal.
  //   - branch admin: solo en sus sucursales habilitadas.
  //   - cajero: prohibido (no es acción operativa).
  if (!access.isBranchAdmin(req)) {
    return res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "Solo administradores pueden crear depósitos.",
    });
  }

  const targetBranchId = Number(body.branch_id);
  if (!access.isSuperAdmin(req)) {
    const allowed = access.getAllowedBranchIds(req);
    if (!allowed.includes(targetBranchId)) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN_BRANCH",
        message: "No podés crear depósitos en otra sucursal.",
      });
    }
  }

  const item = await Warehouse.create({
    branch_id: targetBranchId,
    code: body.code,
    name: body.name,
    is_active: body.is_active ?? 1,
  });

  res.status(201).json({ ok: true, item });
};
