// src/services/telegramNotifier.service.js
// Núcleo del bot de Telegram:
// - ensureTables(): crea tablas si no existen (lazy).
// - getConfig() / saveConfig(): CRUD de la config singleton.
// - sendMessage(): envío directo a Telegram Bot API.
// - sendAlert({ code, title, lines, dedupe_key?, reference_type?, reference_id? }):
//     chequea toggles, dedupe y dispara el mensaje + log.
// - No usa SDKs: Telegram Bot API es HTTP puro.

const axios = require("axios");
const { Op } = require("sequelize");

const models = require("../models");
const { sequelize, TelegramConfig, TelegramAlertLog } = models;

const TELEGRAM_API = "https://api.telegram.org";

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
    const res = await axios.post(url, payload, { timeout: 10000 });
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
    const res = await axios.get(url, { timeout: 8000 });
    if (res?.data?.ok) {
      return { ok: true, bot: res.data.result };
    }
    return { ok: false, error: "Telegram devolvió ok=false" };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.description || e?.message || "Error" };
  }
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
};
