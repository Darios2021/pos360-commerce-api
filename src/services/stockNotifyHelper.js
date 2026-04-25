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
    if (!sb) return;
    // Refrescar la instancia post-UPDATE para obtener el valor real.
    let next = null;
    try {
      await sb.reload({ transaction: t });
      next = Number(sb.qty || 0);
    } catch (_) {
      // Si reload falla, calculamos next manualmente con prev + qty.
      next = Number(prev || 0) + Number(qty || 0);
    }

    const delta = Number(qty != null ? qty : (next - prev));
    const tg = require("./telegramNotifier.service");
    const fire = () =>
      tg.notifyStockChange({
        product_id: sb.product_id,
        warehouse_id: sb.warehouse_id,
        prev: Number(prev || 0),
        next,
        delta,
        source,
      }).catch(() => {});
    if (t && typeof t.afterCommit === "function") {
      t.afterCommit(fire);
    } else {
      fire();
    }
  } catch (_) {
    // Notifier es opcional. Cualquier error no debe romper el flujo de stock.
  }
}

module.exports = { trackStockChange };
