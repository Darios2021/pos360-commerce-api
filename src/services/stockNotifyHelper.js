// src/services/stockNotifyHelper.js
// Helper para disparar alertas de Telegram cuando cambia el stock_balance,
// sin importar el origen (POS, ajustes, transferencias, etc).
//
// Uso:
//   const prev = Number(sb.qty || 0);
//   await sb.update({ qty: literal(`qty - ${qty}`) }, { transaction: t });
//   await trackStockChange({ sb, prev, qty: -qty, t, source: "sale" });
//
// El `qty: literal(...)` evita race conditions pero la instancia local queda
// con un objeto literal — necesitamos reloadear para obtener el valor real.
async function trackStockChange({ sb, prev, qty, t, source = "movement" }) {
  try {
    if (!sb) {
      console.log("[trackStockChange] sb null, skip");
      return;
    }
    // Refrescar la instancia post-UPDATE para obtener el valor real.
    let next = null;
    try {
      await sb.reload({ transaction: t });
      next = Number(sb.qty || 0);
    } catch (e) {
      console.log("[trackStockChange] reload falló, uso prev+qty:", e?.message);
      next = Number(prev || 0) + Number(qty || 0);
    }

    const delta = Number(qty != null ? qty : (next - prev));
    console.log(`[trackStockChange] product=${sb.product_id} wh=${sb.warehouse_id} prev=${prev} next=${next} delta=${delta} source=${source}`);

    const tg = require("./telegramNotifier.service");
    const fire = () => {
      console.log(`[trackStockChange] firing notifyStockChange post-commit product=${sb.product_id} prev=${prev} next=${next}`);
      return tg.notifyStockChange({
        product_id: sb.product_id,
        warehouse_id: sb.warehouse_id,
        prev: Number(prev || 0),
        next,
        delta,
        source,
      }).catch((e) => console.warn("[trackStockChange.fire] error:", e?.message));
    };
    if (t && typeof t.afterCommit === "function") {
      t.afterCommit(fire);
    } else {
      fire();
    }
  } catch (e) {
    console.warn("[trackStockChange] error:", e?.message);
  }
}

// Variante para paths que usan SQL raw (sin instancia Sequelize).
// El caller pasa prev y qty (delta) manualmente.
async function trackStockChangeRaw({ warehouse_id, product_id, prev, qty, t, source = "movement" }) {
  try {
    if (!product_id) {
      console.log("[trackStockChangeRaw] sin product_id, skip");
      return;
    }
    const prevN = Number(prev || 0);
    const deltaN = Number(qty || 0);
    const nextN = prevN + deltaN;

    console.log(`[trackStockChangeRaw] product=${product_id} wh=${warehouse_id} prev=${prevN} next=${nextN} delta=${deltaN} source=${source}`);

    const tg = require("./telegramNotifier.service");
    const fire = () => {
      console.log(`[trackStockChangeRaw] firing notifyStockChange product=${product_id} prev=${prevN} next=${nextN}`);
      return tg.notifyStockChange({
        product_id,
        warehouse_id,
        prev: prevN,
        next: nextN,
        delta: deltaN,
        source,
      }).catch((e) => console.warn("[trackStockChangeRaw.fire] error:", e?.message));
    };
    if (t && typeof t.afterCommit === "function") {
      t.afterCommit(fire);
    } else {
      fire();
    }
  } catch (e) {
    console.warn("[trackStockChangeRaw] error:", e?.message);
  }
}

module.exports = { trackStockChange, trackStockChangeRaw };
