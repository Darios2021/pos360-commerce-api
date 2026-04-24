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

    // Forzamos el envío incluso si enabled está off, pero sólo si hay credenciales.
    // Para test usamos sendMessage directo (bypassea toggles pero respeta enabled).
    if (!cfg.enabled) {
      // Para test permitimos enviar aunque enabled esté en 0:
      const axios = require("axios");
      try {
        const url = `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`;
        await axios.post(url, {
          chat_id: cfg.chat_id,
          text,
          parse_mode: cfg.parse_mode || "HTML",
        }, { timeout: 10000 });
        return res.json({ ok: true, note: "Enviado con bot deshabilitado (modo test)." });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e?.response?.data?.description || e?.message || "Error al enviar",
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
};
