// src/controllers/budgets.controller.js
//
// Presupuestador:
//   - GET    /admin/budgets            → listado paginado
//   - POST   /admin/budgets            → crear (vacío o con cliente)
//   - GET    /admin/budgets/:id        → detalle con renglones
//   - PUT    /admin/budgets/:id        → cabecera (cliente, estado, moneda, notas…)
//   - DELETE /admin/budgets/:id        → eliminar
//   - POST   /admin/budgets/:id/items          → agregar renglón (producto o libre)
//   - PUT    /admin/budgets/:id/items/:itemId  → editar renglón
//   - DELETE /admin/budgets/:id/items/:itemId  → borrar renglón
//
// Regla de oro: los importes SIEMPRE se recalculan acá. El front manda
// cantidad / costo / margen / alícuota y el backend decide precio y totales,
// para que dos pestañas abiertas no puedan dejar un total mentiroso.

"use strict";

const { Op } = require("sequelize");
const { sequelize, Budget, BudgetItem, Product, Customer, User, Branch } = require("../models");
const emailSvc = require("../services/messaging/email.service");
const access = require("../utils/accessScope");

const VALID_STATUS = ["generado", "en_proceso", "entregado", "vendido", "no_venta"];
const VALID_CURRENCY = ["ARS", "USD"];
// Alícuotas que maneja el documento. Cualquier otra se normaliza a 0.
const VALID_VAT = [0, 10.5, 21];

// Vigencia por defecto del presupuesto, en días. Se puede pisar al crearlo
// (valid_days) y cambiar después la fecha a mano (valid_until).
const DEFAULT_VALID_DAYS = 15;

function toNum(v, d = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
}
function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function s(v) {
  return String(v ?? "").trim();
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function normalizeVat(v) {
  const n = toNum(v, 21);
  // 10.5 y 21 con tolerancia; el resto cae en 0 (exento / no gravado)
  const hit = VALID_VAT.find((r) => Math.abs(r - n) < 0.01);
  return hit === undefined ? 0 : hit;
}

function notFound(res) {
  return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Presupuesto no encontrado." });
}
function unavailable(res) {
  return res.status(503).json({
    ok: false,
    code: "BUDGETS_UNAVAILABLE",
    message: "El módulo de presupuestos no está disponible.",
  });
}

// ── Precio base del producto ──────────────────────────────────────────────
// El catálogo hoy no tiene `cost` cargado (0 de 439 productos), así que la
// base no puede ser siempre el costo. price_source elige de dónde sale:
//   sale      → precio de venta vigente, misma cascada que usa el POS
//   list      → precio de lista
//   reseller  → precio revendedor
//   cost      → costo real
//   auto      → costo si está cargado, si no el precio de venta
function firstPositive(...vals) {
  for (const v of vals) {
    const n = toNum(v, 0);
    if (n > 0) return n;
  }
  return 0;
}

function basePriceOf(product, source) {
  const salePrice = firstPositive(
    product.price_discount,
    product.price_list,
    product.price_reseller,
    product.price
  );

  switch (String(source || "auto")) {
    case "cost":
      return { value: toNum(product.cost, 0), used: "cost" };
    case "list":
      return { value: firstPositive(product.price_list, salePrice), used: "list" };
    case "reseller":
      return { value: firstPositive(product.price_reseller, salePrice), used: "reseller" };
    case "sale":
      return { value: salePrice, used: "sale" };
    default: {
      const cost = toNum(product.cost, 0);
      return cost > 0 ? { value: cost, used: "cost" } : { value: salePrice, used: "sale" };
    }
  }
}

// ── Cálculo ───────────────────────────────────────────────────────────────
// precio unitario sin IVA = costo * (1 + margen/100)
function computeItem(raw) {
  const qty = Math.max(0, toNum(raw.qty, 1));
  const cost = Math.max(0, toNum(raw.cost, 0));
  const margin = toNum(raw.margin_pct, 0);
  const unit = cost * (1 + margin / 100);
  return {
    qty,
    cost,
    margin_pct: margin,
    vat_rate: normalizeVat(raw.vat_rate),
    unit_price: unit,
    line_total: round2(unit * qty),
  };
}

// Recalcula totales de cabecera a partir de los renglones ya guardados.
//
// El descuento no es un campo que se cargue: se hace poniendo margen negativo
// en el renglón. Acá se reconstruye cuánto se bonificó (base sin descontar
// menos lo que se cobra) para poder mostrarlo abajo, junto a los totales, que
// es donde el cliente lo busca.
async function recalcTotals(budgetId, t) {
  const items = await BudgetItem.findAll({
    where: { budget_id: budgetId },
    transaction: t,
  });

  let subtotal = 0;
  let gross = 0;
  let vat21 = 0;
  let vat105 = 0;

  for (const it of items) {
    const line = toNum(it.line_total, 0);
    const rate = toNum(it.vat_rate, 0);
    subtotal += line;
    // Solo los renglones bonificados suman a la base: con margen positivo el
    // precio de lista ES el que se está cobrando.
    gross += toNum(it.margin_pct, 0) < 0 ? toNum(it.cost, 0) * toNum(it.qty, 0) : line;
    if (Math.abs(rate - 21) < 0.01) vat21 += line * 0.21;
    else if (Math.abs(rate - 10.5) < 0.01) vat105 += line * 0.105;
  }

  subtotal = round2(subtotal);
  gross = round2(gross);
  vat21 = round2(vat21);
  vat105 = round2(vat105);

  const totals = {
    subtotal_gross: gross,
    discount: round2(Math.max(0, gross - subtotal)),
    subtotal,
    vat_21: vat21,
    vat_105: vat105,
    total: round2(subtotal + vat21 + vat105),
  };

  await Budget.update(totals, { where: { id: budgetId }, transaction: t });
  return totals;
}

// Número del documento: local + correlativo ("001-00035"). Tiene que dar
// igual que budgetNumber() del front, que es el que arma el PDF.
function docNumberOf(budget) {
  const raw = s(budget?.branch_code || budget?.branch?.code);
  const digits = raw.replace(/\D/g, "");
  const local = String(digits || budget?.branch_id || 1).padStart(3, "0").slice(-3);
  return `${local}-${String(toInt(budget?.number, 0)).padStart(5, "0")}`;
}

// Nombre visible del vendedor. El usuario puede no tener nombre y apellido
// cargados, así que se cae a username y por último al email.
function displayNameOf(u) {
  if (!u) return "";
  const full = [s(u.first_name), s(u.last_name)].filter(Boolean).join(" ");
  return full || s(u.username) || s(u.email) || "";
}

// Datos del emisor que van en la cabecera del documento. Viven en
// shop_branding (Ajustes > Contacto del negocio); si la tabla o las columnas
// todavía no existen, el presupuesto se emite igual sin ellos.
async function shopSettings() {
  try {
    // El branding se encarga de que las columnas existan (y de sembrar las
    // observaciones la primera vez). Si falla, seguimos: son datos opcionales.
    try {
      await require("./admin.shopBranding.controller").ensureRow();
    } catch (_) { /* el presupuesto se emite igual */ }

    const [rows] = await sequelize.query(`SELECT * FROM shop_branding WHERE id=1 LIMIT 1`);
    return rows?.[0] || {};
  } catch (e) {
    console.warn("[budgets] shop_branding no disponible:", e?.message || e);
    return {};
  }
}

// Asociaciones que necesita el documento: vendedor y local. Se incluyen para
// los presupuestos viejos, que no tienen el snapshot cargado.
function docIncludes() {
  const inc = [];
  if (User) {
    inc.push({
      model: User,
      as: "user",
      required: false,
      attributes: ["id", "first_name", "last_name", "username", "email"],
    });
  }
  if (Branch) {
    inc.push({ model: Branch, as: "branch", required: false, attributes: ["id", "code", "name"] });
  }
  return inc;
}

async function loadFull(id) {
  return Budget.findByPk(id, {
    include: [
      {
        model: BudgetItem,
        as: "items",
        separate: true,
        order: [["sort_order", "ASC"], ["id", "ASC"]],
      },
      ...docIncludes(),
    ],
  });
}

// ── Cabecera ──────────────────────────────────────────────────────────────

// Qué presupuestos puede ver quien pregunta. Un cajero/vendedor ve solo los
// suyos; admin y super_admin ven todos. No se filtra por sucursal: los
// presupuestos viejos no la tienen cargada y desaparecerían de la lista.
function ownerFilter(req) {
  const scope = access.getAccessScope(req);
  if (scope.kind !== "user") return null;
  return scope.userId || -1;
}

exports.list = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const q = s(req.query.q);
    const status = s(req.query.status);

    const where = {};
    if (status && VALID_STATUS.includes(status)) where.status = status;
    if (q) {
      const like = { [Op.like]: `%${q}%` };
      where[Op.or] = [{ customer_name: like }, { customer_cuit: like }];
      // Si buscó un número, que también matchee el correlativo. El documento se
      // muestra como "001-00035": si lo pega entero, vale la parte de la derecha.
      // El patrón es estricto para que un CUIT no se lea como número de documento.
      const docParts = s(q).match(/^(\d{1,4})-(\d{1,8})$/);
      const asNum = toInt(docParts ? docParts[2] : q, NaN);
      if (Number.isFinite(asNum)) where[Op.or].push({ number: asNum });
    }

    // Un cajero queda restringido a los propios. Un admin puede pedirlo con
    // ?mine=1 para ver solo los que hizo él.
    const owner = ownerFilter(req);
    if (owner !== null) where.user_id = owner;
    else if (["1", "true"].includes(s(req.query.mine))) {
      where.user_id = toInt(req.user?.id, 0) || -1;
    }

    const { rows, count } = await Budget.findAndCountAll({
      where,
      include: docIncludes(),
      order: [["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });

    return res.json({
      ok: true,
      data: rows,
      meta: { page, limit, total: count, pages: Math.ceil(count / limit) || 1 },
    });
  } catch (e) {
    console.error("[budgets.list]", e);
    return res.status(500).json({ ok: false, code: "BUDGETS_LIST_FAILED", message: e.message });
  }
};

exports.getById = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    let budget = await loadFull(id);
    if (!budget) return notFound(res);

    // Los presupuestos anteriores al descuento no tienen la base calculada.
    // Se recalcula la primera vez que se abren, así uno viejo hecho con margen
    // negativo también muestra la bonificación. Idempotente.
    if (toNum(budget.subtotal_gross, 0) === 0 && toNum(budget.subtotal, 0) > 0) {
      const t = await sequelize.transaction();
      try {
        await recalcTotals(id, t);
        await t.commit();
        budget = await loadFull(id);
      } catch (e) {
        await t.rollback();
        console.warn("[budgets.getById] no se pudo recalcular:", e?.message || e);
      }
    }

    return res.json({ ok: true, data: budget });
  } catch (e) {
    console.error("[budgets.getById]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_GET_FAILED", message: e.message });
  }
};

// Resumen para las tarjetas del listado. Se calcula sobre TODOS los
// presupuestos, no sobre la pagina que se esta viendo.
//
// Los importes se guardan en pesos, asi que sumar `total` es correcto aunque
// algun presupuesto se muestre en dolares: la conversion es solo de
// presentacion.
exports.stats = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    // Las tarjetas tienen que hablar del mismo universo que la tabla de abajo:
    // si el usuario solo ve sus presupuestos, los totales también son los suyos.
    const owner = ownerFilter(req);
    const scopeWhere = owner !== null ? { user_id: owner } : {};

    const rows = await Budget.findAll({
      where: scopeWhere,
      attributes: [
        "status",
        [sequelize.fn("COUNT", sequelize.col("id")), "cnt"],
        [sequelize.fn("COALESCE", sequelize.fn("SUM", sequelize.col("total")), 0), "amount"],
      ],
      group: ["status"],
      raw: true,
    });

    const byStatus = {};
    let count = 0;
    let amount = 0;
    for (const r of rows) {
      const cnt = toInt(r.cnt, 0);
      const amt = toNum(r.amount, 0);
      byStatus[r.status] = { count: cnt, amount: amt };
      count += cnt;
      amount += amt;
    }

    // Vencidos: pasaron de fecha y siguen abiertos (ni vendidos ni descartados).
    const expired = await Budget.count({
      where: {
        ...scopeWhere,
        valid_until: { [Op.lt]: new Date() },
        status: { [Op.notIn]: ["vendido", "no_venta"] },
      },
    });

    const sold = byStatus.vendido || { count: 0, amount: 0 };
    const open = count - sold.count - (byStatus.no_venta?.count || 0);

    return res.json({
      ok: true,
      data: {
        count,
        amount,
        open,
        expired,
        sold: sold.count,
        sold_amount: sold.amount,
        by_status: byStatus,
      },
    });
  } catch (e) {
    console.error("[budgets.stats]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_STATS_FAILED", message: e.message });
  }
};

exports.create = async (req, res) => {
  if (!Budget) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const b = req.body || {};

    // Correlativo: MAX+1 dentro de la transacción.
    const last = await Budget.max("number", { transaction: t });
    const number = (toInt(last, 0) || 0) + 1;

    // Vencimiento por defecto: 15 días. Se puede mover después desde el editor.
    const validDays = toInt(b.valid_days, DEFAULT_VALID_DAYS);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (validDays > 0 ? validDays : DEFAULT_VALID_DAYS));

    // Vendedor y local: se congelan al emitir.
    const userId = toInt(req.user?.id, 0) || null;
    const branchId = toInt(req.user?.branch_id ?? b.branch_id, 0) || null;

    let userName = "";
    if (userId && User) {
      const u = await User.findByPk(userId, {
        attributes: ["id", "first_name", "last_name", "username", "email"],
        transaction: t,
      });
      userName = displayNameOf(u);
    }

    let branchCode = "";
    if (branchId && Branch) {
      const br = await Branch.findByPk(branchId, { attributes: ["id", "code"], transaction: t });
      branchCode = s(br?.code);
    }

    // Observaciones al pie: arrancan con las condiciones de siempre (pago,
    // entrega, garantía) y se editan renglón por renglón en cada presupuesto.
    const settings = await shopSettings();
    const defaultNotes = s(settings.budget_notes_default);

    let customerSnapshot = {
      customer_name: s(b.customer_name) || "Consumidor Final",
      customer_email: s(b.customer_email) || null,
      customer_phone: s(b.customer_phone) || null,
      customer_address: s(b.customer_address) || null,
      customer_cuit: s(b.customer_cuit) || null,
    };

    // Si mandaron customer_id, congelamos los datos desde la ficha.
    const customerId = toInt(b.customer_id, 0) || null;
    if (customerId && Customer) {
      const c = await Customer.findByPk(customerId, { transaction: t });
      if (c) {
        customerSnapshot = {
          customer_name: s(c.display_name) || customerSnapshot.customer_name,
          customer_email: s(c.email) || null,
          customer_phone: s(c.phone) || null,
          customer_address: s(c.address) || null,
          customer_cuit: s(c.doc_number) || null,
        };
      }
    }

    const budget = await Budget.create(
      {
        number,
        branch_id: branchId,
        branch_code: branchCode || null,
        user_id: userId,
        user_name: userName || null,
        customer_id: customerId,
        ...customerSnapshot,
        status: VALID_STATUS.includes(s(b.status)) ? s(b.status) : "generado",
        currency: VALID_CURRENCY.includes(s(b.currency)) ? s(b.currency) : "ARS",
        exchange_rate: toNum(b.exchange_rate, 1) || 1,
        valid_until: validUntil,
        notes: s(b.notes) || defaultNotes || null,
        show_cost: b.show_cost === undefined ? true : !!b.show_cost,
      },
      { transaction: t }
    );

    await t.commit();
    return res.status(201).json({ ok: true, data: await loadFull(budget.id) });
  } catch (e) {
    await t.rollback();
    console.error("[budgets.create]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_CREATE_FAILED", message: e.message });
  }
};

exports.update = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    const budget = await Budget.findByPk(id);
    if (!budget) return notFound(res);

    const b = req.body || {};
    const patch = {};

    // Cliente: si viene customer_id lo re-congelamos desde la ficha.
    if (b.customer_id !== undefined) {
      const customerId = toInt(b.customer_id, 0) || null;
      patch.customer_id = customerId;
      if (customerId && Customer) {
        const c = await Customer.findByPk(customerId);
        if (c) {
          patch.customer_name = s(c.display_name) || "Consumidor Final";
          patch.customer_email = s(c.email) || null;
          patch.customer_phone = s(c.phone) || null;
          patch.customer_address = s(c.address) || null;
          patch.customer_cuit = s(c.doc_number) || null;
        }
      }
    }

    // Edición manual de los datos del cliente (pisa el snapshot).
    for (const f of ["customer_name", "customer_email", "customer_phone", "customer_address", "customer_cuit"]) {
      if (b[f] !== undefined) patch[f] = s(b[f]) || (f === "customer_name" ? "Consumidor Final" : null);
    }

    if (b.status !== undefined && VALID_STATUS.includes(s(b.status))) patch.status = s(b.status);
    if (b.currency !== undefined && VALID_CURRENCY.includes(s(b.currency))) patch.currency = s(b.currency);
    if (b.exchange_rate !== undefined) patch.exchange_rate = toNum(b.exchange_rate, 1) || 1;
    if (b.fx_source !== undefined) patch.fx_source = s(b.fx_source) || null;
    if (b.fx_date !== undefined) patch.fx_date = b.fx_date || null;
    if (b.valid_until !== undefined) patch.valid_until = b.valid_until || null;
    if (b.notes !== undefined) patch.notes = s(b.notes) || null;
    if (b.show_cost !== undefined) patch.show_cost = !!b.show_cost;

    await budget.update(patch);
    return res.json({ ok: true, data: await loadFull(id) });
  } catch (e) {
    console.error("[budgets.update]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_UPDATE_FAILED", message: e.message });
  }
};

exports.remove = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    const budget = await Budget.findByPk(id);
    if (!budget) return notFound(res);
    await budget.destroy();
    return res.json({ ok: true });
  } catch (e) {
    console.error("[budgets.remove]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_DELETE_FAILED", message: e.message });
  }
};

// Envío del presupuesto por mail con el PDF adjunto.
//
// El PDF lo genera el navegador (jsPDF) y lo manda en base64: así el cliente
// recibe exactamente el mismo documento que se ve y se descarga, sin mantener
// dos generadores distintos. El backend solo valida y despacha.
const MAX_PDF_BYTES = 8 * 1024 * 1024;

exports.sendByEmail = async (req, res) => {
  if (!Budget) return unavailable(res);
  try {
    const id = toInt(req.params.id, 0);
    const budget = await loadFull(id);
    if (!budget) return notFound(res);

    const b = req.body || {};
    const to = s(b.to);
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_EMAIL",
        message: "El destinatario no es un email válido.",
      });
    }

    const base64 = String(b.pdf_base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!base64) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PDF",
        message: "Falta el PDF del presupuesto.",
      });
    }

    const pdf = Buffer.from(base64, "base64");
    if (!pdf.length || pdf.length > MAX_PDF_BYTES) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_PDF",
        message: "El PDF está vacío o supera el tamaño máximo permitido.",
      });
    }

    const docNumber = docNumberOf(budget);
    const subject = s(b.subject) || `Presupuesto ${docNumber}`;
    const message = s(b.message);
    const cliente = s(budget.customer_name) || "";

    const body = message
      ? message.replace(/\n/g, "<br />")
      : [
          cliente ? `Hola ${cliente},` : "Hola,",
          "<br /><br />",
          `Te enviamos el presupuesto <strong>${docNumber}</strong> en el archivo adjunto.`,
          budget.valid_until
            ? `<br />Tiene validez hasta el ${new Date(budget.valid_until).toLocaleDateString("es-AR")}.`
            : "",
          "<br /><br />Quedamos a disposición por cualquier consulta.",
        ].join("");

    const result = await emailSvc.sendEmail({
      to,
      toName: cliente || undefined,
      subject,
      body,
      attachments: [
        {
          filename: s(b.filename) || `presupuesto-${docNumber}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });

    if (!result?.ok) {
      return res.status(502).json({
        ok: false,
        code: result?.code || "EMAIL_FAILED",
        message: result?.error_message || "No se pudo enviar el correo.",
      });
    }

    // Mandado = entregado al cliente: si seguía en "generado" lo movemos.
    if (budget.status === "generado") {
      await budget.update({ status: "entregado" });
    }

    return res.json({ ok: true, data: { to, message_id: result.message_id || null } });
  } catch (e) {
    console.error("[budgets.sendByEmail]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_EMAIL_FAILED", message: e.message });
  }
};

// ── Renglones ─────────────────────────────────────────────────────────────

exports.addItem = async (req, res) => {
  if (!Budget) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const id = toInt(req.params.id, 0);
    const budget = await Budget.findByPk(id, { transaction: t });
    if (!budget) {
      await t.rollback();
      return notFound(res);
    }

    const b = req.body || {};
    const productId = toInt(b.product_id, 0) || null;

    let base = {
      sku: s(b.sku) || null,
      description: s(b.description) || "Modifique este texto.",
      image_url: s(b.image_url) || null,
      specs: s(b.specs) || null,
      cost: toNum(b.cost, 0),
      vat_rate: b.vat_rate,
      margin_pct: toNum(b.margin_pct, 0),
      qty: toNum(b.qty, 1),
    };

    // Producto del catálogo: congelamos código, descripción, costo y alícuota.
    if (productId && Product) {
      const p = await Product.findByPk(productId, { transaction: t });
      if (!p) {
        await t.rollback();
        return res.status(404).json({ ok: false, code: "PRODUCT_NOT_FOUND", message: "Producto inexistente." });
      }
      base.sku = s(p.sku) || s(p.code) || base.sku;
      base.description = s(p.name) || base.description;
      // Las especificaciones se precargan de la ficha y quedan congeladas.
      base.specs = b.specs !== undefined ? s(b.specs) || null : s(p.description) || null;
      const picked = basePriceOf(p, b.price_source);
      base.cost = b.cost !== undefined ? toNum(b.cost, 0) : picked.value;
      base.price_source = picked.used;
      base.vat_rate = b.vat_rate !== undefined ? b.vat_rate : toNum(p.tax_rate, 21);
      base.margin_pct = toNum(b.margin_pct, 0);
    }

    const calc = computeItem(base);

    const lastOrder = await BudgetItem.max("sort_order", {
      where: { budget_id: id },
      transaction: t,
    });

    const item = await BudgetItem.create(
      {
        budget_id: id,
        product_id: productId,
        sku: base.sku,
        description: base.description,
        image_url: base.image_url,
        specs: base.specs,
        price_source: base.price_source || null,
        ...calc,
        sort_order: (toInt(lastOrder, 0) || 0) + 1,
      },
      { transaction: t }
    );

    const totals = await recalcTotals(id, t);
    await t.commit();
    return res.status(201).json({ ok: true, data: item, totals });
  } catch (e) {
    await t.rollback();
    console.error("[budgets.addItem]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_ITEM_ADD_FAILED", message: e.message });
  }
};

exports.updateItem = async (req, res) => {
  if (!Budget) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const id = toInt(req.params.id, 0);
    const itemId = toInt(req.params.itemId, 0);

    const item = await BudgetItem.findOne({
      where: { id: itemId, budget_id: id },
      transaction: t,
    });
    if (!item) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "ITEM_NOT_FOUND", message: "Renglón no encontrado." });
    }

    const b = req.body || {};

    // Cambio de lista de precios: el costo se vuelve a tomar de la ficha del
    // producto. Se resuelve en el backend porque es el que tiene la cascada de
    // precios; el front no manda importes. Solo aplica a renglones de catalogo.
    let nextCost = b.cost !== undefined ? b.cost : item.cost;
    let nextSource;
    if (b.price_source !== undefined && item.product_id && Product) {
      const p = await Product.findByPk(item.product_id, { transaction: t });
      if (p) {
        const picked = basePriceOf(p, b.price_source);
        nextSource = picked.used;
        if (b.cost === undefined) nextCost = picked.value;
      }
    }

    const calc = computeItem({
      qty: b.qty !== undefined ? b.qty : item.qty,
      cost: nextCost,
      margin_pct: b.margin_pct !== undefined ? b.margin_pct : item.margin_pct,
      vat_rate: b.vat_rate !== undefined ? b.vat_rate : item.vat_rate,
    });

    const patch = { ...calc };
    if (nextSource !== undefined) patch.price_source = nextSource;
    if (b.description !== undefined) patch.description = s(b.description);
    if (b.sku !== undefined) patch.sku = s(b.sku) || null;
    if (b.specs !== undefined) patch.specs = s(b.specs) || null;
    if (b.sort_order !== undefined) patch.sort_order = toInt(b.sort_order, item.sort_order);

    await item.update(patch, { transaction: t });

    const totals = await recalcTotals(id, t);
    await t.commit();
    return res.json({ ok: true, data: item, totals });
  } catch (e) {
    await t.rollback();
    console.error("[budgets.updateItem]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_ITEM_UPDATE_FAILED", message: e.message });
  }
};

exports.removeItem = async (req, res) => {
  if (!Budget) return unavailable(res);
  const t = await sequelize.transaction();
  try {
    const id = toInt(req.params.id, 0);
    const itemId = toInt(req.params.itemId, 0);

    const item = await BudgetItem.findOne({
      where: { id: itemId, budget_id: id },
      transaction: t,
    });
    if (!item) {
      await t.rollback();
      return res.status(404).json({ ok: false, code: "ITEM_NOT_FOUND", message: "Renglón no encontrado." });
    }

    await item.destroy({ transaction: t });
    const totals = await recalcTotals(id, t);
    await t.commit();
    return res.json({ ok: true, totals });
  } catch (e) {
    await t.rollback();
    console.error("[budgets.removeItem]", e);
    return res.status(500).json({ ok: false, code: "BUDGET_ITEM_DELETE_FAILED", message: e.message });
  }
};
