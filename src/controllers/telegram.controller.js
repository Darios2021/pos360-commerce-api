// src/controllers/telegram.controller.js
const svc = require("../services/telegramNotifier.service");

async function getConfig(req, res, next) {
  try {
    const cfg = await svc.getConfig();
    const plain = cfg?.toJSON ? cfg.toJSON() : cfg;

    // No exponemos el token entero; devolvemos una máscara para UI.
    const token = String(plain?.bot_token || "");
    const masked = token
      ? `${token.slice(0, 6)}…${token.slice(-4)}`
      : null;

    return res.json({
      ok: true,
      data: {
        ...plain,
        bot_token_masked: masked,
        bot_token: undefined, // no exponer el token completo
      },
    });
  } catch (e) {
    next(e);
  }
}

async function updateConfig(req, res, next) {
  try {
    const patch = { ...(req.body || {}) };

    // Si mandan bot_token vacío, interpretamos como "no cambiar".
    if (patch.bot_token === "" || patch.bot_token === null) {
      delete patch.bot_token;
    }

    const updated = await svc.saveConfig(patch);
    const plain = updated?.toJSON ? updated.toJSON() : updated;
    const token = String(plain?.bot_token || "");
    const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null;

    return res.json({
      ok: true,
      data: { ...plain, bot_token_masked: masked, bot_token: undefined },
    });
  } catch (e) {
    next(e);
  }
}

async function testSend(req, res, next) {
  try {
    const cfg = await svc.getConfig();
    if (!cfg?.bot_token || !cfg?.chat_id) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_CREDENTIALS",
        message: "Configurá primero el bot_token y el chat_id.",
      });
    }

    const customText = String(req.body?.text || "").trim();
    const text = customText
      || "✅ <b>Prueba de Telegram</b>\nEl bot está configurado correctamente.";

    // Para test permitimos enviar aunque enabled esté en 0, habilitando
    // temporalmente la config en memoria (no persistido).
    if (!cfg.enabled) {
      // Truco: persistir enabled=true transitorio solo para esta llamada.
      // Pero para no ensuciar la DB, simplemente llamamos a sendMessage
      // tras un update temporal. Más seguro: restauramos siempre.
      await svc.saveConfig({ enabled: true });
      try {
        const r = await svc.sendMessage(text);
        await svc.saveConfig({ enabled: false });
        if (!r?.ok) {
          return res.status(500).json({
            ok: false,
            error: r?.error || "No se pudo enviar",
          });
        }
        return res.json({ ok: true, note: "Enviado con bot deshabilitado (modo test)." });
      } catch (e) {
        await svc.saveConfig({ enabled: false });
        return res.status(500).json({
          ok: false,
          error: e?.message || "Error al enviar",
        });
      }
    }

    const result = await svc.sendMessage(text);
    if (!result?.ok) {
      return res.status(500).json({
        ok: false,
        error: result?.error || "No se pudo enviar",
        skipped: result?.skipped || false,
        reason: result?.reason || null,
      });
    }
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

async function ping(req, res, next) {
  try {
    const r = await svc.pingBot();
    if (!r.ok) {
      return res.status(400).json({ ok: false, error: r.error });
    }
    return res.json({ ok: true, bot: r.bot });
  } catch (e) {
    next(e);
  }
}

// Dispara los scans del cron a demanda. Útil para testear sin esperar 10min.
async function runScansNow(req, res, next) {
  try {
    const results = { cash: null, transfers: null };
    try { await svc.scanLongOpenCashRegisters(); results.cash = "ok"; }
    catch (e) { results.cash = e?.message || "error"; }
    try { await svc.scanPendingTransfers(); results.transfers = "ok"; }
    catch (e) { results.transfers = e?.message || "error"; }
    return res.json({ ok: true, results });
  } catch (e) {
    next(e);
  }
}

async function listLogs(req, res, next) {
  try {
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);
    const alert_code = String(req.query?.alert_code || "").trim() || null;

    const { rows, count } = await svc.listLogs({ limit, offset, alert_code });
    return res.json({
      ok: true,
      data: rows,
      meta: { total: count, limit, offset },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getConfig,
  updateConfig,
  testSend,
  ping,
  listLogs,
  runScansNow,
};
