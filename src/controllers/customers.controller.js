// src/controllers/customers.controller.js
//
// CRUD de clientes + utilidades:
//   - GET    /admin/customers           → listado paginado con búsqueda
//   - GET    /admin/customers/:id       → detalle (incluye totales de ventas)
//   - POST   /admin/customers           → crear
//   - PUT    /admin/customers/:id       → editar
//   - DELETE /admin/customers/:id       → desactivar (soft) o eliminar (force=1)
//   - POST   /admin/customers/merge     → mergear duplicados
//   - POST   /admin/customers/backfill  → backfill desde sales (idempotente)
//
// Toda la API requiere admin / super_admin.

"use strict";

const { Op, fn, col, literal } = require("sequelize");
const { sequelize, Customer, Sale } = require("../models");
const access = require("../utils/accessScope");

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toBool(v, d = false) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "si"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return d;
}
function s(v) {
  return String(v ?? "").trim();
}

// Asegura tabla idempotentemente (en caso de que la migración de Sequelize no
// se ejecute en producción).
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    if (Customer && typeof Customer.sync === "function") {
      await Customer.sync({ alter: false });
    }
    tableEnsured = true;
  } catch (e) {
    console.warn("[customers.ensureTable] sync warning:", e?.message);
  }
}

function gateAdminOnly(req, res) {
  if (!access.isBranchAdmin(req)) {
    res.status(403).json({
      ok: false,
      code: "FORBIDDEN",
      message: "Solo administradores pueden gestionar clientes.",
    });
    return false;
  }
  return true;
}

// Construye `display_name` desde first/last/fallback al doc o phone.
function buildDisplayName(payload) {
  const fn_ = s(payload.first_name);
  const ln_ = s(payload.last_name);
  const dn_ = s(payload.display_name);
  if (dn_) return dn_;
  const full = [fn_, ln_].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (s(payload.email)) return s(payload.email);
  if (s(payload.phone)) return s(payload.phone);
  if (s(payload.doc_number)) return `Cliente ${s(payload.doc_number)}`;
  return "Cliente";
}

// Normaliza nombre para matching insensible a may/min/acentos/espacios.
function normalizeName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quitar acentos
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function normalizePhone(v) {
  return String(v || "").replace(/[^\d+]/g, "");
}
function normalizeDoc(v) {
  return String(v || "").replace(/\D/g, "");
}

// ============================================================
// LIST
// ============================================================
async function list(req, res, next) {
  try {
    // Lectura abierta: cualquier usuario autenticado puede ver el listado.
    // Las acciones de escritura (create/update/remove/merge/backfill) siguen siendo admin-only.
    await ensureTable();
    if (!Customer) return res.status(500).json({ ok: false, message: "Modelo Customer no disponible" });

    const page  = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 25)));
    const offset = (page - 1) * limit;

    const q = s(req.query.q);
    const customer_type = s(req.query.customer_type).toUpperCase();
    const acceptsPromos = req.query.accepts_promos != null
      ? toBool(req.query.accepts_promos, null)
      : null;

    const where = {};
    if (q) {
      const like = `%${q}%`;
      where[Op.or] = [
        { display_name: { [Op.like]: like } },
        { first_name:   { [Op.like]: like } },
        { last_name:    { [Op.like]: like } },
        { email:        { [Op.like]: like } },
        { phone:        { [Op.like]: like } },
        { doc_number:   { [Op.like]: like } },
      ];
    }
    if (customer_type && ["CONSUMIDOR_FINAL","RESPONSABLE_INSCRIPTO","MONOTRIBUTO","EXENTO","OTRO"].includes(customer_type)) {
      where.customer_type = customer_type;
    }
    if (acceptsPromos != null) where.accepts_promos = acceptsPromos;

    const { rows, count } = await Customer.findAndCountAll({
      where,
      order: [["display_name", "ASC"]],
      limit,
      offset,
    });

    // Adjuntar totales de venta (best-effort).
    const ids = rows.map((r) => r.id);
    let totals = {};
    if (ids.length) {
      const stats = await Sale.findAll({
        attributes: [
          "customer_id",
          [fn("COUNT", col("Sale.id")), "sales_count"],
          [fn("SUM", col("total")), "sales_total"],
          [fn("MAX", col("sold_at")), "last_sold_at"],
        ],
        where: { customer_id: { [Op.in]: ids }, status: "PAID" },
        group: ["customer_id"],
        raw: true,
      });
      for (const r of stats) {
        totals[r.customer_id] = {
          sales_count: Number(r.sales_count || 0),
          sales_total: Number(r.sales_total || 0),
          last_sold_at: r.last_sold_at || null,
        };
      }
    }

    return res.json({
      ok: true,
      data: rows.map((r) => ({ ...r.toJSON(), stats: totals[r.id] || null })),
      meta: { page, limit, total: count, pages: Math.ceil(count / limit) || 1 },
    });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// GET BY ID
// ============================================================
async function getById(req, res, next) {
  try {
    // Lectura abierta: cualquier usuario autenticado puede ver el detalle.
    await ensureTable();
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const row = await Customer.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    // Stats + últimas ventas.
    const [stats] = await Sale.findAll({
      attributes: [
        [fn("COUNT", col("id")), "sales_count"],
        [fn("SUM", col("total")), "sales_total"],
        [fn("AVG", col("total")), "avg_ticket"],
        [fn("MAX", col("sold_at")), "last_sold_at"],
      ],
      where: { customer_id: id, status: "PAID" },
      raw: true,
    });

    const recent = await Sale.findAll({
      where: { customer_id: id },
      order: [["id", "DESC"]],
      limit: 20,
      attributes: ["id", "sale_number", "status", "total", "sold_at", "branch_id"],
    });

    return res.json({
      ok: true,
      data: {
        ...row.toJSON(),
        stats: {
          sales_count: Number(stats?.sales_count || 0),
          sales_total: Number(stats?.sales_total || 0),
          avg_ticket: Number(stats?.avg_ticket || 0),
          last_sold_at: stats?.last_sold_at || null,
        },
        recent_sales: recent,
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// CREATE
// ============================================================
async function create(req, res, next) {
  try {
    if (!gateAdminOnly(req, res)) return;
    await ensureTable();
    const body = req.body || {};

    const payload = {
      first_name: s(body.first_name) || null,
      last_name:  s(body.last_name) || null,
      display_name: buildDisplayName(body),
      doc_type:   s(body.doc_type) || null,
      doc_number: s(body.doc_number) || null,
      email:      s(body.email) || null,
      phone:      s(body.phone) || null,
      address:    s(body.address) || null,
      city:       s(body.city) || null,
      province:   s(body.province) || null,
      postal_code:s(body.postal_code) || null,
      customer_type: s(body.customer_type).toUpperCase() || "CONSUMIDOR_FINAL",
      tax_condition: s(body.tax_condition) || null,
      accepts_promos: toBool(body.accepts_promos, false),
      tags:       s(body.tags) || null,
      notes:      s(body.notes) || null,
      source:     s(body.source) || "admin",
      is_active:  body.is_active === false ? false : true,
    };

    // Si manda doc_number, evitamos duplicados estrictos.
    if (payload.doc_number) {
      const exists = await Customer.findOne({ where: { doc_number: payload.doc_number } });
      if (exists) {
        return res.status(409).json({
          ok: false,
          code: "DUPLICATE_DOC",
          message: `Ya existe un cliente con documento ${payload.doc_number} (#${exists.id} ${exists.display_name}).`,
          data: { id: exists.id },
        });
      }
    }

    const row = await Customer.create(payload);
    return res.status(201).json({ ok: true, data: row });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// UPDATE
// ============================================================
async function update(req, res, next) {
  try {
    if (!gateAdminOnly(req, res)) return;
    await ensureTable();
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const row = await Customer.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const body = req.body || {};

    if ("first_name" in body)    row.first_name = s(body.first_name) || null;
    if ("last_name" in body)     row.last_name  = s(body.last_name) || null;
    if ("doc_type" in body)      row.doc_type   = s(body.doc_type) || null;
    if ("doc_number" in body)    row.doc_number = s(body.doc_number) || null;
    if ("email" in body)         row.email      = s(body.email) || null;
    if ("phone" in body)         row.phone      = s(body.phone) || null;
    if ("address" in body)       row.address    = s(body.address) || null;
    if ("city" in body)          row.city       = s(body.city) || null;
    if ("province" in body)      row.province   = s(body.province) || null;
    if ("postal_code" in body)   row.postal_code= s(body.postal_code) || null;
    if ("customer_type" in body) row.customer_type = s(body.customer_type).toUpperCase() || "CONSUMIDOR_FINAL";
    if ("tax_condition" in body) row.tax_condition = s(body.tax_condition) || null;
    if ("accepts_promos" in body) row.accepts_promos = toBool(body.accepts_promos, false);
    if ("tags" in body)          row.tags       = s(body.tags) || null;
    if ("notes" in body)         row.notes      = s(body.notes) || null;
    if ("is_active" in body)     row.is_active  = toBool(body.is_active, row.is_active);

    // Recalcular display_name si cambió first/last/display_name.
    if ("first_name" in body || "last_name" in body || "display_name" in body) {
      row.display_name = buildDisplayName({
        first_name: row.first_name,
        last_name: row.last_name,
        display_name: body.display_name,
        email: row.email,
        phone: row.phone,
        doc_number: row.doc_number,
      });
    }

    await row.save();
    return res.json({ ok: true, data: row });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// DELETE (soft por defecto, force=1 hard-delete)
// ============================================================
async function remove(req, res, next) {
  try {
    if (!gateAdminOnly(req, res)) return;
    await ensureTable();
    const id = toInt(req.params.id, 0);
    if (!id) return res.status(400).json({ ok: false, code: "BAD_ID" });

    const row = await Customer.findByPk(id);
    if (!row) return res.status(404).json({ ok: false, code: "NOT_FOUND" });

    const force = String(req.query.force || "0") === "1";

    if (!force) {
      // Soft: desactivar y desvincular nada (las ventas siguen apuntando).
      await row.update({ is_active: false });
      return res.json({ ok: true, message: "Cliente desactivado", soft: true });
    }

    // Hard: poner customer_id=NULL en sales (preservamos snapshots) y eliminar.
    await sequelize.transaction(async (t) => {
      await sequelize.query(
        `UPDATE sales SET customer_id = NULL WHERE customer_id = :id`,
        { replacements: { id }, transaction: t }
      );
      await row.destroy({ transaction: t });
    });

    return res.json({ ok: true, message: "Cliente eliminado", hard: true });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// MERGE — fusiona N customers en uno (target)
// body: { target_id, source_ids: [] }
// Reasigna sales.customer_id de los source al target y elimina los source.
// Permite "limpiar" duplicados como "FEDE BALAGUER" / "FEDE BALSGUER" /
// "Federico Balaguer" en un solo customer.
// ============================================================
async function merge(req, res, next) {
  try {
    if (!gateAdminOnly(req, res)) return;
    await ensureTable();

    const target_id = toInt(req.body?.target_id, 0);
    const source_ids = Array.isArray(req.body?.source_ids)
      ? req.body.source_ids.map((x) => toInt(x, 0)).filter(Boolean)
      : [];

    if (!target_id) {
      return res.status(400).json({ ok: false, code: "TARGET_REQUIRED", message: "target_id es obligatorio" });
    }
    if (!source_ids.length) {
      return res.status(400).json({ ok: false, code: "SOURCES_REQUIRED", message: "source_ids vacío" });
    }
    if (source_ids.includes(target_id)) {
      return res.status(400).json({ ok: false, code: "TARGET_IN_SOURCES", message: "target_id no puede estar en source_ids" });
    }

    const target = await Customer.findByPk(target_id);
    if (!target) return res.status(404).json({ ok: false, code: "TARGET_NOT_FOUND" });

    let updated = 0;
    await sequelize.transaction(async (t) => {
      // Reasignar sales de los sources al target.
      const [r] = await sequelize.query(
        `UPDATE sales SET customer_id = :target WHERE customer_id IN (:sources)`,
        { replacements: { target: target_id, sources: source_ids }, transaction: t }
      );
      updated = r?.affectedRows || 0;

      // Eliminar customers source.
      await Customer.destroy({
        where: { id: { [Op.in]: source_ids } },
        transaction: t,
      });
    });

    return res.json({
      ok: true,
      message: `Mergeados ${source_ids.length} cliente(s) en #${target_id}`,
      data: { target_id, merged: source_ids.length, sales_reassigned: updated },
    });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// BACKFILL — crea customers desde sales agrupando duplicados
// Idempotente: si ya existen customers, no se crean duplicados.
//
// Estrategia de match (orden):
//   1) doc_number normalizado (solo dígitos)
//   2) phone normalizado (solo dígitos)
//   3) email lowercase
//   4) display_name normalizado (sin acentos, lowercase, espacios uniformes)
//
// Para cada grupo: crea 1 customer (o usa existente) y actualiza
// sales.customer_id en todas las ventas del grupo que aún no tengan.
// ============================================================
async function backfill(req, res, next) {
  try {
    if (!gateAdminOnly(req, res)) return;
    await ensureTable();

    const dryRun = toBool(req.query.dry_run, false);

    // Traer todas las ventas con algún dato de cliente.
    const sales = await sequelize.query(
      `
      SELECT
        id,
        customer_id,
        TRIM(IFNULL(customer_name, '')) AS customer_name,
        TRIM(IFNULL(customer_doc, '')) AS customer_doc,
        TRIM(IFNULL(customer_phone, '')) AS customer_phone,
        TRIM(IFNULL(customer_email, '')) AS customer_email,
        TRIM(IFNULL(customer_address, '')) AS customer_address,
        TRIM(IFNULL(customer_doc_type, '')) AS customer_doc_type,
        TRIM(IFNULL(customer_tax_condition, '')) AS customer_tax_condition,
        TRIM(IFNULL(customer_type, '')) AS customer_type
      FROM sales
      WHERE
        TRIM(IFNULL(customer_name, '')) <> ''
        OR TRIM(IFNULL(customer_doc, '')) <> ''
        OR TRIM(IFNULL(customer_phone, '')) <> ''
        OR TRIM(IFNULL(customer_email, '')) <> ''
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    // Agrupar por clave de match.
    const groups = new Map(); // key → { sale_ids: [], sample: {...} }
    for (const r of sales) {
      const docKey   = normalizeDoc(r.customer_doc);
      const phoneKey = normalizePhone(r.customer_phone);
      const emailKey = String(r.customer_email || r.email || "").trim().toLowerCase();
      const nameKey  = normalizeName(r.customer_name);

      // Antes excluíamos a "Consumidor Final" del backfill, pero eso ocultaba
      // muchos clientes reales que dejaron DNI o teléfono pero el cajero los
      // tipeó como "Consumidor Final". Ahora la regla es:
      //   - Si tienen doc / phone / email distintivos, los importamos
      //     (incluso si el nombre dice "Consumidor Final"), agrupados por ese
      //     identificador único.
      //   - Si solo tienen nombre y NO es genérico, los importamos por nombre.
      //   - Si tienen ÚNICAMENTE nombre genérico (sin doc/phone/email), los
      //     ignoramos (esos quedan como ventas anónimas, sin customer_id).
      const isGenericName = ["consumidor final", "publico general", "consumidor", "consumidor_final", ""].includes(nameKey);

      let key = docKey || phoneKey || emailKey;
      if (!key && !isGenericName) {
        key = nameKey;
      }
      if (!key) continue;

      if (!groups.has(key)) {
        groups.set(key, {
          sale_ids: [],
          sample: r,
          name_variants: new Set(),
        });
      }
      const g = groups.get(key);
      g.sale_ids.push(r.id);
      if (r.customer_name) g.name_variants.add(r.customer_name.trim());

      // Si encontramos un sample con datos más completos (doc/phone), preferirlo
      // como referencia para el customer que vamos a crear.
      if (!normalizeDoc(g.sample.customer_doc) && docKey) g.sample = r;
      else if (!normalizePhone(g.sample.customer_phone) && phoneKey && !normalizeDoc(g.sample.customer_doc)) g.sample = r;
    }

    let createdCount = 0;
    let reusedCount = 0;
    let updatedSales = 0;
    const summary = [];

    // Cuando el nombre del sample es genérico ("Consumidor Final") y el grupo
    // se identifica por DNI/teléfono, NO usamos ese nombre como display porque
    // colisionaría con todos los demás Consumidor Final. Generamos un display
    // único basado en el dato distintivo.
    function buildBackfillDisplay(sample, key) {
      const rawName = String(sample.customer_name || "").trim();
      const normName = normalizeName(rawName);
      const isGenericName = ["consumidor final", "consumidor", "publico general", ""].includes(normName);
      if (rawName && !isGenericName) return rawName;
      if (sample.customer_doc)   return `Cliente DNI ${sample.customer_doc}`;
      if (sample.customer_phone) return `Cliente Tel ${sample.customer_phone}`;
      if (sample.customer_email) return `Cliente ${sample.customer_email}`;
      return `Cliente ${String(key).slice(0, 30)}`;
    }

    for (const [key, g] of groups) {
      const sample = g.sample;
      const display = buildBackfillDisplay(sample, key);

      // Tipo de identificador del grupo: por qué se está agrupando.
      // Esto define qué match es legítimo y cuál no, para evitar que dos
      // grupos distintos terminen pegados al mismo customer (bug anterior:
      // el match por nombre genérico mezclaba todos los DNI distintos en
      // el primer customer "Consumidor Final" creado).
      const groupBy =
        normalizeDoc(sample.customer_doc) ? "doc" :
        normalizePhone(sample.customer_phone) ? "phone" :
        String(sample.customer_email || "").trim().toLowerCase() ? "email" : "name";

      // Match estrictamente por el identificador del grupo:
      let row = null;
      if (groupBy === "doc") {
        // Buscamos tanto por el formato crudo como por solo dígitos para
        // capturar customers viejos que se guardaron con prefijo "DNI N°...".
        const cleanDigits = normalizeDoc(sample.customer_doc);
        row = await Customer.findOne({
          where: {
            [Op.or]: [
              { doc_number: sample.customer_doc },
              ...(cleanDigits ? [{ doc_number: cleanDigits }] : []),
            ],
          },
        });
      } else if (groupBy === "phone") {
        row = await Customer.findOne({ where: { phone: sample.customer_phone } });
      } else if (groupBy === "email") {
        row = await Customer.findOne({ where: { email: sample.customer_email.toLowerCase() } });
      } else {
        // Solo cuando el grupo se identifica por NOMBRE (sin doc/phone/email)
        // intentamos matchear por display_name normalizado. Esto evita que
        // dos clientes con DNI distintos terminen pegados porque ambos se
        // llaman "Consumidor Final".
        const norm = normalizeName(display);
        if (norm) {
          row = await Customer.findOne({
            where: literal(
              `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(display_name,'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u')) = ${sequelize.escape(norm)}`
            ),
          });
        }
      }

      if (!row && !dryRun) {
        // Limpiar el doc_number: en sales a veces se guarda con prefijo
        // ("DNI 23682047") porque el formulario POS concatena el doc_type.
        // En la tabla customers queremos solo el número (que ya tenemos
        // separado en doc_type), para que las búsquedas y comparaciones
        // funcionen.
        let cleanDocNumber = null;
        if (sample.customer_doc) {
          const raw = String(sample.customer_doc).trim();
          // Si el raw contiene letras (ej: "DNI 23682047"), nos quedamos
          // solo con la parte numérica. Si es puro número, lo dejamos.
          const digits = raw.replace(/\D/g, "");
          cleanDocNumber = digits || raw;
        }

        row = await Customer.create({
          display_name: display.slice(0, 200),
          first_name: null,
          last_name: null,
          doc_type: sample.customer_doc_type || null,
          doc_number: cleanDocNumber,
          phone: sample.customer_phone || null,
          email: sample.customer_email ? String(sample.customer_email).toLowerCase() : null,
          address: sample.customer_address || null,
          customer_type:
            ["CONSUMIDOR_FINAL","RESPONSABLE_INSCRIPTO","MONOTRIBUTO","EXENTO","OTRO"]
              .includes(String(sample.customer_type).toUpperCase())
              ? String(sample.customer_type).toUpperCase() : "CONSUMIDOR_FINAL",
          tax_condition: sample.customer_tax_condition || null,
          source: "backfill",
          notes: g.name_variants.size > 1
            ? `Backfill — variantes: ${Array.from(g.name_variants).slice(0, 6).join(" / ")}`
            : null,
        });
        createdCount++;
      } else if (row) {
        // Si existe pero no tiene email/phone/etc, completar con lo que el sample aporte.
        const patch = {};
        if (!row.email && sample.customer_email)     patch.email = String(sample.customer_email).toLowerCase();
        if (!row.phone && sample.customer_phone)     patch.phone = sample.customer_phone;
        if (!row.address && sample.customer_address) patch.address = sample.customer_address;
        if (!row.doc_number && sample.customer_doc)  patch.doc_number = sample.customer_doc;
        if (!row.doc_type && sample.customer_doc_type) patch.doc_type = sample.customer_doc_type;
        if (Object.keys(patch).length && !dryRun) {
          await row.update(patch);
        }
        reusedCount++;
      }

      if (row && !dryRun) {
        // Actualizar sales del grupo que aún no tienen customer_id correcto.
        const [r] = await sequelize.query(
          `UPDATE sales SET customer_id = :cid
           WHERE id IN (:ids) AND (customer_id IS NULL OR customer_id <> :cid)`,
          { replacements: { cid: row.id, ids: g.sale_ids } }
        );
        updatedSales += r?.affectedRows || 0;
      }

      summary.push({
        key,
        customer_id: row?.id || null,
        sample_name: display,
        sale_count: g.sale_ids.length,
        name_variants: Array.from(g.name_variants),
      });
    }

    return res.json({
      ok: true,
      dry_run: dryRun,
      message: dryRun
        ? `Análisis: ${groups.size} grupos detectados, sin cambios aplicados.`
        : `Backfill OK. Creados: ${createdCount}. Reusados: ${reusedCount}. Ventas vinculadas: ${updatedSales}.`,
      data: {
        groups: groups.size,
        created: createdCount,
        reused: reusedCount,
        sales_linked: updatedSales,
        sample: summary.slice(0, 30),
      },
    });
  } catch (e) {
    next(e);
  }
}

// ============================================================
// STATS
// Métricas agregadas para dashboard del listado.
// Lectura abierta (mismos filtros base que list, sin paginar).
// ============================================================
async function getStats(req, res, next) {
  try {
    await ensureTable();
    if (!Customer) return res.status(500).json({ ok: false, message: "Modelo Customer no disponible" });

    const q = s(req.query.q);
    const customer_type = s(req.query.customer_type).toUpperCase();

    const where = {};
    if (q) {
      const like = `%${q}%`;
      where[Op.or] = [
        { display_name: { [Op.like]: like } },
        { first_name:   { [Op.like]: like } },
        { last_name:    { [Op.like]: like } },
        { email:        { [Op.like]: like } },
        { phone:        { [Op.like]: like } },
        { doc_number:   { [Op.like]: like } },
      ];
    }
    if (customer_type && ["CONSUMIDOR_FINAL","RESPONSABLE_INSCRIPTO","MONOTRIBUTO","EXENTO","OTRO"].includes(customer_type)) {
      where.customer_type = customer_type;
    }

    const [total, withContact, withPromos] = await Promise.all([
      Customer.count({ where }),
      Customer.count({
        where: {
          ...where,
          [Op.or]: [
            { email: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
            { phone: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
          ],
        },
      }),
      Customer.count({ where: { ...where, accepts_promos: true } }),
    ]);

    // with_purchases: clientes que tienen al menos 1 venta PAID
    let withPurchases = 0;
    try {
      const ids = await Customer.findAll({ where, attributes: ["id"], raw: true });
      const idList = ids.map((r) => r.id);
      if (idList.length) {
        const buyers = await Sale.findAll({
          attributes: [[fn("DISTINCT", col("customer_id")), "customer_id"]],
          where: { customer_id: { [Op.in]: idList }, status: "PAID" },
          raw: true,
        });
        withPurchases = buyers.length;
      }
    } catch {
      withPurchases = 0;
    }

    return res.json({
      ok: true,
      data: {
        total,
        with_contact: withContact,
        accepts_promos: withPromos,
        with_purchases: withPurchases,
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, getById, create, update, remove, merge, backfill, getStats };
