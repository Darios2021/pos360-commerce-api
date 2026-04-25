// src/services/telegramNotifier.service.js
// Núcleo del bot de Telegram:
// - ensureTables(): crea tablas si no existen (lazy).
// - getConfig() / saveConfig(): CRUD de la config singleton.
// - sendMessage(): envío directo a Telegram Bot API.
// - sendAlert({ code, title, lines, dedupe_key?, reference_type?, reference_id? }):
//     chequea toggles, dedupe y dispara el mensaje + log.
// - No usa SDKs: Telegram Bot API es HTTP puro.

const { Op } = require("sequelize");

const models = require("../models");
const { sequelize, TelegramConfig, TelegramAlertLog } = models;

const TELEGRAM_API = "https://api.telegram.org";

// Helper: hace POST JSON a Telegram Bot API con fetch nativo (Node 18+).
// Si corren en Node <18, fetch no existe → fallback a https nativo.
async function telegramPost(url, body) {
  if (typeof fetch === "function") {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(data?.description || `HTTP ${r.status}`);
        err.response = { data };
        throw err;
      }
      return { data };
    } finally {
      clearTimeout(t);
    }
  }
  // Fallback para Node < 18
  return new Promise((resolve, reject) => {
    const https = require("https");
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 10000,
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let data = {};
          try { data = JSON.parse(buf); } catch (_) {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ data });
          else {
            const err = new Error(data?.description || `HTTP ${res.statusCode}`);
            err.response = { data };
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

async function telegramGet(url) {
  if (typeof fetch === "function") {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(url, { signal: controller.signal });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(data?.description || `HTTP ${r.status}`);
        err.response = { data };
        throw err;
      }
      return { data };
    } finally {
      clearTimeout(t);
    }
  }
  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let data = {};
          try { data = JSON.parse(buf); } catch (_) {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ data });
          else {
            const err = new Error(data?.description || `HTTP ${res.statusCode}`);
            err.response = { data };
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

// Umbrales por default — se pueden overridear desde TelegramConfig.thresholds.
const DEFAULT_THRESHOLDS = {
  cash_max_session_hours: 8,
  cash_shortage_severe_pct: 0.1,
  cash_shortage_severe_abs: 5000,
  cash_surplus_big_pct: 0.05,
  cash_surplus_big_abs: 1000,
  cash_big_out_pct: 0.2,
  cash_big_out_min: 500,
  stock_low_min_qty: 3,
  stock_big_adjust_qty: 50,
  dedupe_window_hours: 24, // no repetir misma alerta en 24h
};

let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS telegram_config (
      id INT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
      bot_token VARCHAR(255) NULL,
      chat_id VARCHAR(64) NULL,
      parse_mode VARCHAR(16) NOT NULL DEFAULT 'HTML',
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      alert_cash_shortage TINYINT(1) NOT NULL DEFAULT 1,
      alert_cash_surplus TINYINT(1) NOT NULL DEFAULT 1,
      alert_cash_long_open TINYINT(1) NOT NULL DEFAULT 1,
      alert_cash_overtime TINYINT(1) NOT NULL DEFAULT 1,
      alert_cash_big_out TINYINT(1) NOT NULL DEFAULT 0,
      alert_stock_zero TINYINT(1) NOT NULL DEFAULT 1,
      alert_stock_low TINYINT(1) NOT NULL DEFAULT 0,
      alert_stock_negative TINYINT(1) NOT NULL DEFAULT 1,
      alert_stock_big_adjust TINYINT(1) NOT NULL DEFAULT 0,
      alert_shop_new_order TINYINT(1) NOT NULL DEFAULT 0,
      alert_transfer_dispatched TINYINT(1) NOT NULL DEFAULT 1,
      alert_transfer_pending TINYINT(1) NOT NULL DEFAULT 1,
      thresholds TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS telegram_alerts_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      alert_code VARCHAR(64) NOT NULL,
      reference_type VARCHAR(64) NULL,
      reference_id BIGINT UNSIGNED NULL,
      dedupe_key VARCHAR(160) NULL,
      chat_id VARCHAR(64) NULL,
      text TEXT NULL,
      payload TEXT NULL,
      success TINYINT(1) NOT NULL DEFAULT 1,
      error TEXT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tg_alert_code (alert_code),
      INDEX idx_tg_dedupe (dedupe_key),
      INDEX idx_tg_ref (reference_type, reference_id),
      INDEX idx_tg_sent (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Seed de la fila singleton si no existe.
  await sequelize.query(
    `INSERT IGNORE INTO telegram_config (id) VALUES (1)`
  );

  // Migración de columnas nuevas (idempotente).
  // Si la tabla ya existía sin estas columnas las agregamos.
  const newCols = [
    { name: "alert_transfer_dispatched", ddl: "TINYINT(1) NOT NULL DEFAULT 1" },
    { name: "alert_transfer_pending",    ddl: "TINYINT(1) NOT NULL DEFAULT 1" },
  ];
  for (const c of newCols) {
    try {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'telegram_config' AND COLUMN_NAME = :name`,
        { replacements: { name: c.name } }
      );
      const exists = Number(rows?.[0]?.n || 0) > 0;
      if (!exists) {
        await sequelize.query(`ALTER TABLE telegram_config ADD COLUMN ${c.name} ${c.ddl}`);
      }
    } catch (e) {
      console.warn(`[telegram] migración de columna ${c.name} falló:`, e?.message);
    }
  }

  tablesReady = true;
}

async function getConfig() {
  await ensureTables();
  if (!TelegramConfig) return null;
  const row = await TelegramConfig.findByPk(1);
  if (!row) {
    return await TelegramConfig.create({ id: 1 });
  }
  return row;
}

async function saveConfig(patch = {}) {
  await ensureTables();
  if (!TelegramConfig) return null;

  const allowed = [
    "bot_token", "chat_id", "parse_mode", "enabled",
    "alert_cash_shortage", "alert_cash_surplus", "alert_cash_long_open",
    "alert_cash_overtime", "alert_cash_big_out",
    "alert_stock_zero", "alert_stock_low", "alert_stock_negative",
    "alert_stock_big_adjust", "alert_shop_new_order",
    "alert_transfer_dispatched", "alert_transfer_pending",
    "thresholds",
  ];

  const data = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) data[k] = patch[k];
  }
  data.updated_at = new Date();

  const existing = await TelegramConfig.findByPk(1);
  if (existing) {
    await existing.update(data);
    return existing;
  }
  return await TelegramConfig.create({ id: 1, ...data });
}

function getThresholds(cfg) {
  const custom = cfg?.thresholds || null;
  return { ...DEFAULT_THRESHOLDS, ...(custom || {}) };
}

// Envío crudo vía Telegram Bot API. Devuelve { ok, data, error }.
async function sendMessage(text, opts = {}) {
  await ensureTables();
  const cfg = await getConfig();

  if (!cfg || !cfg.enabled) {
    return { ok: false, skipped: true, reason: "disabled" };
  }
  if (!cfg.bot_token || !cfg.chat_id) {
    return { ok: false, skipped: true, reason: "missing_credentials" };
  }

  const payload = {
    chat_id: opts.chat_id || cfg.chat_id,
    text,
    parse_mode: opts.parse_mode || cfg.parse_mode || "HTML",
    disable_web_page_preview: opts.disable_preview !== false,
    disable_notification: !!opts.silent,
  };

  try {
    const url = `${TELEGRAM_API}/bot${cfg.bot_token}/sendMessage`;
    const res = await telegramPost(url, payload);
    return { ok: true, data: res?.data || null };
  } catch (e) {
    const desc =
      e?.response?.data?.description ||
      e?.message ||
      "Error desconocido al enviar a Telegram";
    return { ok: false, error: desc };
  }
}

function buildDedupeKey({ code, reference_type, reference_id, extra }) {
  const parts = [code, reference_type || "", reference_id || "", extra || ""];
  return parts.filter(Boolean).join(":").slice(0, 160);
}

async function recentlySent({ dedupe_key, windowHours }) {
  if (!dedupe_key || !TelegramAlertLog) return false;
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const row = await TelegramAlertLog.findOne({
    where: {
      dedupe_key,
      success: true,
      sent_at: { [Op.gte]: since },
    },
    attributes: ["id"],
  });
  return !!row;
}

async function logAlert({ code, reference_type, reference_id, dedupe_key, chat_id, text, payload, success, error }) {
  if (!TelegramAlertLog) return;
  try {
    await TelegramAlertLog.create({
      alert_code: code,
      reference_type: reference_type || null,
      reference_id: reference_id || null,
      dedupe_key: dedupe_key || null,
      chat_id: chat_id || null,
      text: text || null,
      payload: payload || null,
      success: !!success,
      error: error || null,
    });
  } catch (e) {
    console.warn("[telegram.logAlert] fallo:", e?.message);
  }
}

// Formatea un mensaje de alerta con header + líneas + footer.
function formatAlert({ title, lines, severity, ref }) {
  const emojiBySeverity = { high: "🚨", medium: "⚠️", low: "ℹ️" };
  const emoji = emojiBySeverity[severity] || "🔔";

  const body = (lines || [])
    .filter(Boolean)
    .map((l) => (typeof l === "string" ? l : `<b>${l.k}:</b> ${l.v}`))
    .join("\n");

  const footer = ref
    ? `\n\n<i>Ref: ${ref}</i>`
    : "";

  return `${emoji} <b>${escapeHtml(title)}</b>\n${body}${footer}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Envía alerta si:
// - El bot está habilitado.
// - El toggle correspondiente al código está activo.
// - No fue enviada en la ventana de dedupe.
//
// `toggleKey` apunta a la columna de TelegramConfig (ej: "alert_cash_shortage").
// Si se omite, no se chequea (siempre pasa al filtro).
async function sendAlert({
  code,
  title,
  lines,
  severity = "medium",
  toggleKey = null,
  reference_type = null,
  reference_id = null,
  dedupe_key_extra = null,
  ref = null,
  silent = false,
}) {
  await ensureTables();
  const cfg = await getConfig();

  if (!cfg?.enabled) return { ok: false, skipped: true, reason: "disabled" };
  if (toggleKey && !cfg[toggleKey]) {
    return { ok: false, skipped: true, reason: `toggle_off:${toggleKey}` };
  }

  const dedupe_key = buildDedupeKey({ code, reference_type, reference_id, extra: dedupe_key_extra });
  const thresholds = getThresholds(cfg);
  const already = await recentlySent({ dedupe_key, windowHours: thresholds.dedupe_window_hours });

  if (already) return { ok: false, skipped: true, reason: "dedupe" };

  const text = formatAlert({ title, lines, severity, ref });
  const res = await sendMessage(text, { silent });

  await logAlert({
    code,
    reference_type,
    reference_id,
    dedupe_key,
    chat_id: cfg.chat_id,
    text,
    payload: { severity, toggleKey },
    success: !!res?.ok,
    error: res?.error || null,
  });

  return res;
}

async function listLogs({ limit = 100, offset = 0, alert_code = null } = {}) {
  await ensureTables();
  if (!TelegramAlertLog) return { rows: [], count: 0 };

  const where = {};
  if (alert_code) where.alert_code = alert_code;

  const { rows, count } = await TelegramAlertLog.findAndCountAll({
    where,
    order: [["sent_at", "DESC"], ["id", "DESC"]],
    limit: Math.min(500, Math.max(1, Number(limit) || 100)),
    offset: Math.max(0, Number(offset) || 0),
  });

  return { rows, count };
}

// Health-check de la config: verifica que el bot responda con getMe.
async function pingBot() {
  await ensureTables();
  const cfg = await getConfig();
  if (!cfg?.bot_token) {
    return { ok: false, error: "Falta bot_token" };
  }
  try {
    const url = `${TELEGRAM_API}/bot${cfg.bot_token}/getMe`;
    const res = await telegramGet(url);
    if (res?.data?.ok) {
      return { ok: true, bot: res.data.result };
    }
    return { ok: false, error: "Telegram devolvió ok=false" };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.description || e?.message || "Error" };
  }
}

// ──────────────────────────────────────────────────────────────
// HELPERS DE EVENTOS DE DOMINIO
// Cada función encapsula la lógica de "¿amerita alerta?" y la dispara.
// Se llaman desde los hooks correspondientes (stock.service, cashRegister.service, cron).
// Todas son fire-and-forget: jamás deben tirar throw para no romper el flujo principal.
// ──────────────────────────────────────────────────────────────

async function notifyStockChange({ product_id, warehouse_id, prev, next, delta, source = "movement" }) {
  try {
    if (!product_id) return;

    const cfg = await getConfig();
    if (!cfg?.enabled) return;

    const flagsToCheck = [
      cfg.alert_stock_zero,
      cfg.alert_stock_low,
      cfg.alert_stock_negative,
      cfg.alert_stock_big_adjust,
    ];
    if (!flagsToCheck.some(Boolean)) return;

    const prevN = Number(prev || 0);
    const nextN = Number(next || 0);
    const deltaN = Number(delta || (nextN - prevN));
    const thresholds = getThresholds(cfg);

    // Resolver datos del producto para el mensaje.
    let productInfo = { name: `Producto #${product_id}`, sku: "" };
    try {
      const { Product } = require("../models");
      if (Product) {
        const p = await Product.findByPk(product_id, {
          attributes: ["id", "name", "sku", "code", "barcode"],
        });
        if (p) {
          productInfo = {
            name: p.name || `Producto #${product_id}`,
            sku: p.sku || p.code || "",
          };
        }
      }
    } catch (_) {}

    let warehouseName = warehouse_id ? `Depósito #${warehouse_id}` : "—";
    try {
      const { Warehouse, Branch } = require("../models");
      if (warehouse_id && Warehouse) {
        const w = await Warehouse.findByPk(warehouse_id, { attributes: ["id", "name", "branch_id"] });
        if (w) {
          warehouseName = w.name || warehouseName;
          if (w.branch_id && Branch) {
            const b = await Branch.findByPk(w.branch_id, { attributes: ["id", "name"] });
            if (b?.name) warehouseName = `${warehouseName} · ${b.name}`;
          }
        }
      }
    } catch (_) {}

    const productLine = productInfo.sku
      ? `${productInfo.name} <code>${escapeHtml(productInfo.sku)}</code>`
      : productInfo.name;

    // Reglas (en orden de severidad — sólo dispara la primera que aplica).
    // STOCK_NEGATIVE: stock quedó por debajo de cero (error grave).
    if (cfg.alert_stock_negative && nextN < 0) {
      await sendAlert({
        code: "STOCK_NEGATIVE",
        title: "Stock negativo",
        severity: "high",
        toggleKey: "alert_stock_negative",
        reference_type: "product",
        reference_id: product_id,
        dedupe_key_extra: warehouse_id ? `wh${warehouse_id}` : "",
        lines: [
          `📦 ${productLine}`,
          `🏬 ${escapeHtml(warehouseName)}`,
          { k: "Stock", v: `<b style="color:red">${nextN}</b> (era ${prevN}, Δ ${deltaN >= 0 ? "+" : ""}${deltaN})` },
          `<i>Origen: ${escapeHtml(source)}</i>`,
        ],
      });
      return;
    }

    // STOCK_ZERO: pasó de >0 a 0 (rotura de stock).
    if (cfg.alert_stock_zero && prevN > 0 && nextN <= 0) {
      await sendAlert({
        code: "STOCK_ZERO",
        title: "Stock agotado",
        severity: "high",
        toggleKey: "alert_stock_zero",
        reference_type: "product",
        reference_id: product_id,
        dedupe_key_extra: warehouse_id ? `wh${warehouse_id}` : "",
        lines: [
          `📦 ${productLine}`,
          `🏬 ${escapeHtml(warehouseName)}`,
          { k: "Stock", v: `<b>0</b> (era ${prevN})` },
        ],
      });
      return;
    }

    // STOCK_LOW: bajó del mínimo configurado y no llegó a 0.
    if (
      cfg.alert_stock_low &&
      prevN >= thresholds.stock_low_min_qty &&
      nextN < thresholds.stock_low_min_qty &&
      nextN > 0
    ) {
      await sendAlert({
        code: "STOCK_LOW",
        title: "Stock por debajo del mínimo",
        severity: "medium",
        toggleKey: "alert_stock_low",
        reference_type: "product",
        reference_id: product_id,
        dedupe_key_extra: warehouse_id ? `wh${warehouse_id}` : "",
        lines: [
          `📦 ${productLine}`,
          `🏬 ${escapeHtml(warehouseName)}`,
          { k: "Stock", v: `<b>${nextN}</b> (mínimo ${thresholds.stock_low_min_qty})` },
        ],
      });
      return;
    }

    // STOCK_BIG_ADJUST: ajuste manual grande.
    if (
      cfg.alert_stock_big_adjust &&
      source === "adjustment" &&
      Math.abs(deltaN) >= thresholds.stock_big_adjust_qty
    ) {
      await sendAlert({
        code: "STOCK_BIG_ADJUST",
        title: "Ajuste manual grande",
        severity: "medium",
        toggleKey: "alert_stock_big_adjust",
        reference_type: "product",
        reference_id: product_id,
        lines: [
          `📦 ${productLine}`,
          `🏬 ${escapeHtml(warehouseName)}`,
          { k: "Ajuste", v: `${deltaN >= 0 ? "+" : ""}${deltaN} unidades` },
          { k: "Stock", v: `${prevN} → ${nextN}` },
        ],
      });
    }
  } catch (e) {
    console.warn("[telegram.notifyStockChange] error:", e?.message);
  }
}

async function notifyCashRegisterClose({ cash_register_id }) {
  try {
    if (!cash_register_id) return;
    const cfg = await getConfig();
    if (!cfg?.enabled) return;

    const { CashRegister, User, Branch } = require("../models");
    if (!CashRegister) return;

    const cr = await CashRegister.findByPk(cash_register_id);
    if (!cr) return;

    const thresholds = getThresholds(cfg);
    const opening = Number(cr.opening_cash || 0);
    const diff = cr.difference_cash != null ? Number(cr.difference_cash) : null;
    const openedAt = cr.opened_at ? new Date(cr.opened_at).getTime() : null;
    const closedAt = cr.closed_at ? new Date(cr.closed_at).getTime() : Date.now();
    const durationHours = openedAt ? (closedAt - openedAt) / 3600000 : 0;

    let cashierName = "—";
    try {
      if (User && cr.opened_by) {
        const u = await User.findByPk(cr.opened_by, {
          attributes: ["id", "first_name", "last_name", "email", "username"],
        });
        if (u) {
          const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
          cashierName = full || u.username || u.email || `Usuario #${u.id}`;
        }
      }
    } catch (_) {}

    let branchName = "—";
    try {
      if (Branch && cr.branch_id) {
        const b = await Branch.findByPk(cr.branch_id, { attributes: ["id", "name"] });
        if (b?.name) branchName = b.name;
      }
    } catch (_) {}

    const baseLines = [
      `🧾 Caja <b>#${cr.id}</b> · ${escapeHtml(branchName)}`,
      `👤 ${escapeHtml(cashierName)}`,
      { k: "Duración", v: `${durationHours.toFixed(1)}h` },
    ];

    // SHORTAGE: faltante.
    if (cfg.alert_cash_shortage && diff != null && diff < 0) {
      const absDiff = Math.abs(diff);
      const pct = opening > 0 ? absDiff / opening : 0;
      const severe = absDiff >= thresholds.cash_shortage_severe_abs || pct >= thresholds.cash_shortage_severe_pct;
      await sendAlert({
        code: "CASH_SHORTAGE",
        title: severe ? "Faltante grave en caja" : "Faltante en caja",
        severity: severe ? "high" : "medium",
        toggleKey: "alert_cash_shortage",
        reference_type: "cash_register",
        reference_id: cr.id,
        lines: [
          ...baseLines,
          { k: "Diferencia", v: `<b style="color:red">-$${fmtMoney(absDiff)}</b>` + (opening > 0 ? ` (${(pct * 100).toFixed(1)}%)` : "") },
          { k: "Esperado", v: `$${fmtMoney(cr.expected_cash || 0)}` },
          { k: "Declarado", v: `$${fmtMoney(cr.closing_cash || 0)}` },
        ],
      });
    }

    // SURPLUS: sobrante atípico.
    if (cfg.alert_cash_surplus && diff != null && diff > 0) {
      const pct = opening > 0 ? diff / opening : 0;
      if (diff >= thresholds.cash_surplus_big_abs || pct >= thresholds.cash_surplus_big_pct) {
        await sendAlert({
          code: "CASH_SURPLUS",
          title: "Sobrante atípico en caja",
          severity: "medium",
          toggleKey: "alert_cash_surplus",
          reference_type: "cash_register",
          reference_id: cr.id,
          lines: [
            ...baseLines,
            { k: "Diferencia", v: `<b style="color:green">+$${fmtMoney(diff)}</b>` + (opening > 0 ? ` (${(pct * 100).toFixed(1)}%)` : "") },
            { k: "Esperado", v: `$${fmtMoney(cr.expected_cash || 0)}` },
            { k: "Declarado", v: `$${fmtMoney(cr.closing_cash || 0)}` },
          ],
        });
      }
    }

    // OVERTIME: cierre tras +8h.
    if (cfg.alert_cash_overtime && durationHours > thresholds.cash_max_session_hours) {
      await sendAlert({
        code: "CASH_OVERTIME",
        title: "Cierre con turno excedido",
        severity: "medium",
        toggleKey: "alert_cash_overtime",
        reference_type: "cash_register",
        reference_id: cr.id,
        lines: [
          ...baseLines,
          { k: "Duración", v: `<b>${durationHours.toFixed(1)}h</b> (límite ${thresholds.cash_max_session_hours}h)` },
        ],
      });
    }
  } catch (e) {
    console.warn("[telegram.notifyCashRegisterClose] error:", e?.message);
  }
}

async function notifyTransferDispatched({ transfer_id }) {
  try {
    if (!transfer_id) return;
    const cfg = await getConfig();
    if (!cfg?.enabled || !cfg.alert_transfer_dispatched) return;

    const { StockTransfer, StockTransferItem, Warehouse, Branch, User, Product } = require("../models");
    if (!StockTransfer) return;

    const tr = await StockTransfer.findByPk(transfer_id, {
      include: [
        { model: Warehouse, as: "fromWarehouse", required: false, include: [{ model: Branch, as: "branch", required: false }] },
        { model: Warehouse, as: "toWarehouse", required: false, include: [{ model: Branch, as: "branch", required: false }] },
        { model: Branch, as: "toBranch", required: false },
        {
          model: StockTransferItem, as: "items", required: false,
          include: Product ? [{ model: Product, as: "product", required: false, attributes: ["id", "name", "sku", "code"] }] : [],
        },
        { model: User, as: "creator", required: false, attributes: ["id", "first_name", "last_name", "username", "email"] },
        { model: User, as: "dispatcher", required: false, attributes: ["id", "first_name", "last_name", "username", "email"] },
      ],
    });
    if (!tr) return;

    const fromName = tr.fromWarehouse?.branch?.name || tr.fromWarehouse?.name || "—";
    const toName = tr.toBranch?.name || tr.toWarehouse?.branch?.name || tr.toWarehouse?.name || "—";
    const itemsArr = Array.isArray(tr.items) ? tr.items : [];

    const userName = (u) => {
      if (!u) return "—";
      const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      return full || u.username || u.email || `Usuario #${u.id}`;
    };

    const lines = [
      `📦 <b>${escapeHtml(tr.number || `#${tr.id}`)}</b>`,
      `📤 De: ${escapeHtml(fromName)}`,
      `📥 A: ${escapeHtml(toName)}`,
      { k: "Items", v: `${itemsArr.length}` },
      { k: "Creada por", v: escapeHtml(userName(tr.creator)) },
      { k: "Despachada por", v: escapeHtml(userName(tr.dispatcher)) },
    ];

    // Lista de productos (máx 8 para no spamear).
    const itemsToShow = itemsArr.slice(0, 8);
    if (itemsToShow.length) {
      lines.push("\n<b>Productos:</b>");
      for (const it of itemsToShow) {
        const pname = it.product?.name || `Producto #${it.product_id}`;
        const psku = it.product?.sku || it.product?.code || "";
        const qty = Number(it.qty || it.quantity || 0);
        const skuTag = psku ? ` <code>${escapeHtml(psku)}</code>` : "";
        lines.push(`• ${escapeHtml(pname)}${skuTag} ×${qty}`);
      }
      if (itemsArr.length > itemsToShow.length) {
        lines.push(`<i>… +${itemsArr.length - itemsToShow.length} producto(s) más</i>`);
      }
    }

    if (tr.note) {
      lines.push(`📝 ${escapeHtml(String(tr.note).slice(0, 200))}`);
    }

    await sendAlert({
      code: "TRANSFER_DISPATCHED",
      title: "Nueva derivación enviada",
      severity: "low",
      toggleKey: "alert_transfer_dispatched",
      reference_type: "stock_transfer",
      reference_id: tr.id,
      lines,
    });
  } catch (e) {
    console.warn("[telegram.notifyTransferDispatched] error:", e?.message);
  }
}

// Cron: derivaciones despachadas hace +24h sin recibir.
async function scanPendingTransfers() {
  try {
    const cfg = await getConfig();
    if (!cfg?.enabled || !cfg.alert_transfer_pending) return;

    const { StockTransfer, StockTransferItem, Warehouse, Branch, User, Product } = require("../models");
    if (!StockTransfer) return;

    const cutoff = new Date(Date.now() - 24 * 3600 * 1000); // > 24h

    const rows = await StockTransfer.findAll({
      where: {
        status: "dispatched",
        dispatched_at: { [Op.lte]: cutoff },
      },
      include: [
        { model: Warehouse, as: "fromWarehouse", required: false, include: [{ model: Branch, as: "branch", required: false }] },
        { model: Branch, as: "toBranch", required: false },
        {
          model: StockTransferItem, as: "items", required: false,
          include: Product ? [{ model: Product, as: "product", required: false, attributes: ["id", "name", "sku", "code"] }] : [],
        },
        { model: User, as: "creator", required: false, attributes: ["id", "first_name", "last_name", "username", "email"] },
        { model: User, as: "dispatcher", required: false, attributes: ["id", "first_name", "last_name", "username", "email"] },
      ],
      attributes: ["id", "number", "from_warehouse_id", "to_branch_id", "dispatched_at", "note", "created_by", "dispatched_by"],
    });

    const userName = (u) => {
      if (!u) return "—";
      const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      return full || u.username || u.email || `Usuario #${u.id}`;
    };

    for (const tr of rows) {
      const hours = (Date.now() - new Date(tr.dispatched_at).getTime()) / 3600000;
      const fromName = tr.fromWarehouse?.branch?.name || tr.fromWarehouse?.name || "—";
      const toName = tr.toBranch?.name || "—";
      const itemsArr = Array.isArray(tr.items) ? tr.items : [];

      const lines = [
        `📦 <b>${escapeHtml(tr.number || `#${tr.id}`)}</b>`,
        `📤 De: ${escapeHtml(fromName)}`,
        `📥 A: ${escapeHtml(toName)}`,
        { k: "Pendiente hace", v: `<b>${hours.toFixed(1)}h</b>` },
        { k: "Items", v: `${itemsArr.length}` },
        { k: "Creada por", v: escapeHtml(userName(tr.creator)) },
        { k: "Despachada por", v: escapeHtml(userName(tr.dispatcher)) },
      ];

      const itemsToShow = itemsArr.slice(0, 8);
      if (itemsToShow.length) {
        lines.push("\n<b>Productos:</b>");
        for (const it of itemsToShow) {
          const pname = it.product?.name || `Producto #${it.product_id}`;
          const psku = it.product?.sku || it.product?.code || "";
          const qty = Number(it.qty || it.quantity || 0);
          const skuTag = psku ? ` <code>${escapeHtml(psku)}</code>` : "";
          lines.push(`• ${escapeHtml(pname)}${skuTag} ×${qty}`);
        }
        if (itemsArr.length > itemsToShow.length) {
          lines.push(`<i>… +${itemsArr.length - itemsToShow.length} producto(s) más</i>`);
        }
      }

      await sendAlert({
        code: "TRANSFER_PENDING",
        title: "Derivación pendiente de recibir",
        severity: "medium",
        toggleKey: "alert_transfer_pending",
        reference_type: "stock_transfer",
        reference_id: tr.id,
        // Dedupe por día → la misma derivación pendiente solo una vez por día.
        dedupe_key_extra: new Date().toISOString().slice(0, 10),
        lines,
      });
    }
  } catch (e) {
    console.warn("[telegram.scanPendingTransfers] error:", e?.message);
  }
}

// Cron: escanea cajas abiertas hace +8h y notifica.
// Se llama desde un setInterval en el bootstrap del server.
async function scanLongOpenCashRegisters() {
  try {
    const cfg = await getConfig();
    if (!cfg?.enabled || !cfg.alert_cash_long_open) return;

    const { CashRegister, User, Branch } = require("../models");
    if (!CashRegister) return;

    const thresholds = getThresholds(cfg);
    const limitMs = thresholds.cash_max_session_hours * 3600 * 1000;
    const cutoff = new Date(Date.now() - limitMs);

    const rows = await CashRegister.findAll({
      where: {
        status: "OPEN",
        opened_at: { [Op.lte]: cutoff },
      },
      attributes: ["id", "branch_id", "opened_by", "opened_at", "opening_cash"],
    });

    for (const cr of rows) {
      const hours = (Date.now() - new Date(cr.opened_at).getTime()) / 3600000;

      let cashierName = "—";
      try {
        if (User && cr.opened_by) {
          const u = await User.findByPk(cr.opened_by, {
            attributes: ["id", "first_name", "last_name", "username", "email"],
          });
          if (u) {
            const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
            cashierName = full || u.username || u.email || `Usuario #${u.id}`;
          }
        }
      } catch (_) {}

      let branchName = "—";
      try {
        if (Branch && cr.branch_id) {
          const b = await Branch.findByPk(cr.branch_id, { attributes: ["id", "name"] });
          if (b?.name) branchName = b.name;
        }
      } catch (_) {}

      await sendAlert({
        code: "CASH_LONG_OPEN",
        title: "Caja abierta +8h",
        severity: "high",
        toggleKey: "alert_cash_long_open",
        reference_type: "cash_register",
        reference_id: cr.id,
        // Dedupe por día: si cae en el mismo día, no se reenvía (24h ventana default).
        dedupe_key_extra: new Date().toISOString().slice(0, 10),
        lines: [
          `🧾 Caja <b>#${cr.id}</b> · ${escapeHtml(branchName)}`,
          `👤 ${escapeHtml(cashierName)}`,
          { k: "Abierta hace", v: `<b>${hours.toFixed(1)}h</b>` },
        ],
      });
    }
  } catch (e) {
    console.warn("[telegram.scanLongOpenCashRegisters] error:", e?.message);
  }
}

let scanInterval = null;
function startCronJobs(intervalMinutes = 10) {
  if (scanInterval) return;
  const ms = Math.max(1, Number(intervalMinutes) || 10) * 60 * 1000;
  const runAllScans = async () => {
    try { await scanLongOpenCashRegisters(); } catch (e) { console.warn("[telegram.cron.cash]", e?.message); }
    try { await scanPendingTransfers(); }     catch (e) { console.warn("[telegram.cron.transfer]", e?.message); }
  };
  scanInterval = setInterval(runAllScans, ms);
  // Primera corrida a los 30s del arranque, para no esperar el primer ciclo.
  setTimeout(runAllScans, 30 * 1000);
  console.log(`[telegram] cron activo (cada ${intervalMinutes} min): cajas largas + derivaciones pendientes`);
}
function stopCronJobs() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

function fmtMoney(n) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

module.exports = {
  ensureTables,
  getConfig,
  saveConfig,
  sendMessage,
  sendAlert,
  listLogs,
  pingBot,
  formatAlert,
  DEFAULT_THRESHOLDS,
  notifyStockChange,
  notifyCashRegisterClose,
  notifyTransferDispatched,
  scanLongOpenCashRegisters,
  scanPendingTransfers,
  startCronJobs,
  stopCronJobs,
};
