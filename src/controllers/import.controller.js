// src/controllers/import.controller.js
const { parse } = require("csv-parse/sync");
const { Product, Category } = require("../models");

function s(v) {
  const x = (v ?? "").toString().trim();
  return x.length ? x : null;
}

function d(v, def = 0) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : def;
}

function i(v, def = 0) {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : def;
}

function b(v, def = 0) {
  if (v === null || v === undefined) return def;
  const t = String(v).trim().toLowerCase();
  if (["1", "true", "si", "sí", "s", "yes", "y"].includes(t)) return 1;
  if (["0", "false", "no", "n"].includes(t)) return 0;
  return def;
}

// OJO: tu tabla categories tiene name único global (según versiones previas).
// Para evitar choque, decoramos subrubros si hace falta.
async function getOrCreateCategory({ name, parentId = null }) {
  if (!name) return null;

  const clean = name.trim();

  // intento directo (name + parent_id)
  let cat = await Category.findOne({
    where: { name: clean, parent_id: parentId },
  });
  if (cat) return cat;

  // Si es subrubro y el name ya existe global con otro parent, decoramos
  if (parentId) {
    const parent = await Category.findByPk(parentId);
    const decorated = parent ? `${parent.name} > ${clean}` : clean;

    cat = await Category.findOne({
      where: { name: decorated, parent_id: parentId },
    });
    if (cat) return cat;

    return Category.create({
      name: decorated,
      parent_id: parentId,
      is_active: 1,
    });
  }

  // rubro raíz
  return Category.create({
    name: clean,
    parent_id: null,
    is_active: 1,
  });
}

exports.importProductsCsv = async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res
        .status(400)
        .json({ ok: false, message: "Falta archivo CSV en field 'file'" });
    }

    const raw = req.file.buffer;

    // Intento UTF-8 primero
    let text = raw.toString("utf8");

    // Heurística: si vienen muchos � => era latin1/ansi desde Excel
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCount > 5) {
      text = raw.toString("latin1");
    }

    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ",",
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    });

    let created = 0;
    let updated = 0;
    const errors = [];

    for (let idx = 0; idx < records.length; idx++) {
      const row = records[idx];

      const sku = s(row.sku || row.SKU);
      const name = s(row.name || row.Nombre);
      if (!sku || !name) {
        errors.push({ row: idx + 2, sku, error: "Falta sku o name" });
        continue;
      }

      // rubro/subrubro desde CSV
      const rubroName = s(row.rubro || row.Rubro);
      const subName = s(row.sub_rubro || row.Subrubro || row["sub rubro"]);

      // categoría árbol
      let rubro = null;
      let sub = null;

      if (rubroName) rubro = await getOrCreateCategory({ name: rubroName, parentId: null });
      if (subName && rubro?.id) sub = await getOrCreateCategory({ name: subName, parentId: rubro.id });

      const category_id = sub?.id ?? rubro?.id ?? null;

      // ✅ DESCRIPTION REAL (no repite name)
      const description = s(row.description || row.Descripcion);

      const payload = {
        code: s(row.code),
        sku,
        barcode: s(row.barcode),
        name,
        description,

        category_id,

        brand: s(row.brand || row.Marca),
        model: s(row.model || row.Modelo),
        warranty_months: i(row.warranty_months, 0),

        is_new: b(row.is_new, 0),
        is_promo: b(row.is_promo, 0),
        track_stock: b(row.track_stock, 1),
        is_active: b(row.is_active, 1),

        cost: d(row.cost, 0),
        price: d(row.price, 0),
        price_list: d(row.price_list, 0),
        price_discount: d(row.price_discount, 0),
        price_reseller: d(row.price_reseller, 0),

        tax_rate: d(row.tax_rate, 21),
      };

      try {
        const existing = await Product.findOne({ where: { sku } });
        if (existing) {
          await existing.update(payload);
          updated++;
        } else {
          await Product.create(payload);
          created++;
        }
      } catch (e) {
        errors.push({ row: idx + 2, sku, error: e?.message || String(e) });
      }
    }

    res.json({
      ok: true,
      created,
      updated,
      total: records.length,
      errorsCount: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (e) {
    next(e);
  }
};
