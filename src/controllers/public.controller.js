// src/controllers/public.controller.js
// ✅ COPY-PASTE FINAL

const PublicService = require("../services/public.service");
const { Category } = require("../models"); // ✅ NUEVO

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}
function toBoolLike(v, d = false) {
  if (v === undefined || v === null || v === "") return d;
  const s = String(v).toLowerCase();
  if (["1", "true", "yes", "si"].includes(s)) return true;
  if (["0", "false", "no"].includes(s)) return false;
  return d;
}

module.exports = {
  // =========================
  // ✅ RUBROS (categories parent_id NULL)
  // GET /api/v1/public/categories
  // =========================
  async listCategories(req, res) {
    try {
      const items = await Category.findAll({
        where: { is_active: 1, parent_id: null },
        order: [["name", "ASC"]],
        attributes: ["id", "name"],
      });
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATEGORIES_ERROR",
        message: err?.message || "Error listando categorías",
      });
    }
  },

  // =========================
  // ✅ SUBRUBROS (categories parent_id = category_id)
  // GET /api/v1/public/subcategories?category_id=1
  // =========================
  async listSubcategories(req, res) {
    try {
      const category_id = toInt(req.query.category_id);
      if (!category_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "category_id es obligatorio",
        });
      }

      const items = await Category.findAll({
        where: { is_active: 1, parent_id: category_id },
        order: [["name", "ASC"]],
        attributes: ["id", "name", "parent_id"],
      });

      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_SUBCATEGORIES_ERROR",
        message: err?.message || "Error listando subcategorías",
      });
    }
  },

  // =========================
  // Sucursales
  // =========================
  async listBranches(req, res) {
    try {
      const items = await PublicService.listBranches();
      res.json({ ok: true, items });
    } catch (err) {
      res.status(500).json({ ok: false, code: "PUBLIC_BRANCHES_ERROR", message: err?.message });
    }
  },

  // =========================
  // Catálogo
  // =========================
  async listCatalog(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      if (!branch_id) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "branch_id es obligatorio" });
      }

      const result = await PublicService.listCatalog({
        branch_id,
        search: toStr(req.query.search),
        category_id: toInt(req.query.category_id) || null,
        subcategory_id: toInt(req.query.subcategory_id) || null,
        in_stock: toBoolLike(req.query.in_stock, true),
        page: Math.max(1, toInt(req.query.page, 1)),
        limit: Math.min(100, Math.max(1, toInt(req.query.limit, 24))),
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, code: "PUBLIC_CATALOG_ERROR", message: err?.message });
    }
  },

  // =========================
  // Producto por ID
  // =========================
  async getProductById(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      const product_id = toInt(req.params.id);

      if (!branch_id || !product_id) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "branch_id e id son obligatorios" });
      }

      const item = await PublicService.getProductById({ branch_id, product_id });
      if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

      res.json({ ok: true, item });
    } catch (err) {
      res.status(500).json({ ok: false, code: "PUBLIC_PRODUCT_ERROR", message: err?.message });
    }
  },

  // =========================
  // Crear pedido Ecommerce (sin pago)
  // =========================
  async createOrder(req, res) {
    try {
      const payload = req.body || {};

      const branch_id = toInt(payload.branch_id);
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!branch_id) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "branch_id es obligatorio" });
      }
      if (!items.length) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "items es obligatorio" });
      }

      const customer = payload.customer || {};
      const fulfillment = payload.fulfillment || {};

      // Normalizar items: {product_id, qty}
      const normItems = items
        .map((it) => ({
          product_id: toInt(it.product_id),
          qty: Math.max(0, toNum(it.qty, 0)),
        }))
        .filter((it) => it.product_id && it.qty > 0);

      if (!normItems.length) {
        return res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "items inválidos" });
      }

      const result = await PublicService.createOrder({
        branch_id,
        items: normItems,
        customer: {
          email: toStr(customer.email),
          first_name: toStr(customer.first_name),
          last_name: toStr(customer.last_name),
          phone: toStr(customer.phone),
          doc_number: toStr(customer.doc_number),
        },
        fulfillment: {
          type: toStr(fulfillment.type) || "pickup", // pickup|delivery
          ship_name: toStr(fulfillment.ship_name),
          ship_phone: toStr(fulfillment.ship_phone),
          ship_address1: toStr(fulfillment.ship_address1),
          ship_address2: toStr(fulfillment.ship_address2),
          ship_city: toStr(fulfillment.ship_city),
          ship_province: toStr(fulfillment.ship_province),
          ship_zip: toStr(fulfillment.ship_zip),
        },
        notes: toStr(payload.notes),
      });

      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_ORDER_ERROR",
        message: err?.message || "Error creando pedido",
      });
    }
  },
};
