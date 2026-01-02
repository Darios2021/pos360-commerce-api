// src/controllers/public.controller.js
// ✅ COPY-PASTE FINAL

const PublicService = require("../services/public.service");

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
  // ✅ Taxonomía (usa categories + parent_id)
  // =========================
  async listCategories(req, res) {
    try {
      const items = await PublicService.listCategories(); // padres
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATEGORIES_ERROR",
        message: err?.message || "Error listando categorías",
      });
    }
  },

  async listSubcategories(req, res) {
    try {
      const category_id = toInt(req.query.category_id);
      if (!category_id) {
        return res
          .status(400)
          .json({ ok: false, code: "VALIDATION_ERROR", message: "category_id es obligatorio" });
      }

      const items = await PublicService.listSubcategories({ category_id }); // hijos
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
  // Branches
  // =========================
  async listBranches(req, res) {
    try {
      const items = await PublicService.listBranches();
      return res.json({ ok: true, items });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_BRANCHES_ERROR",
        message: err?.message || "Error listando sucursales",
      });
    }
  },

  // =========================
  // Catalog
  // =========================
  async listCatalog(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      if (!branch_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "branch_id es obligatorio",
        });
      }

      const result = await PublicService.listCatalog({
        branch_id,
        search: toStr(req.query.search),
        // ✅ IMPORTANTE:
        // category_id = rubro padre o subrubro (hijo)
        category_id: toInt(req.query.category_id) || null,
        // ✅ include_children: si category_id es padre, trae hijos también
        include_children: toBoolLike(req.query.include_children, false),
        in_stock: toBoolLike(req.query.in_stock, true),
        page: Math.max(1, toInt(req.query.page, 1)),
        limit: Math.min(100, Math.max(1, toInt(req.query.limit, 24))),
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_CATALOG_ERROR",
        message: err?.message || "Error listando catálogo",
      });
    }
  },

  async getProductById(req, res) {
    try {
      const branch_id = toInt(req.query.branch_id);
      const product_id = toInt(req.params.id);

      if (!branch_id || !product_id) {
        return res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "branch_id e id son obligatorios",
        });
      }

      const item = await PublicService.getProductById({ branch_id, product_id });
      if (!item) return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Producto no encontrado" });

      return res.json({ ok: true, item });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "PUBLIC_PRODUCT_ERROR",
        message: err?.message || "Error obteniendo producto",
      });
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
          type: toStr(fulfillment.type) || "pickup",
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
