/* script/cleanup-expired-promos.js
   Limpia promociones vencidas: setea is_promo=0 y resetea los campos
   promo_* en productos cuya ventana temporal (promo_ends_at) ya pasó.

   Reglas:
   - Solo afecta filas con is_promo=1 Y promo_ends_at IS NOT NULL Y promo_ends_at < NOW().
   - NO toca productos con promo_ends_at NULL (promos sin ventana temporal,
     deben quedar activas hasta que el usuario las apague manualmente).
   - NO toca productos donde sólo está configurada la promo por cantidad.

   Uso:
   - DRY RUN (no cambia nada): node script/cleanup-expired-promos.js --dry-run
   - Ejecutar y limpiar:        node script/cleanup-expired-promos.js

   Cron sugerido (VPS, cron del sistema), corre una vez por día a las 03:17 AM:
     17 3 * * * cd /opt/pos360-commerce-api && /usr/bin/node script/cleanup-expired-promos.js >> /var/log/pos360-cleanup-promos.log 2>&1
*/

const { sequelize } = require("../src/loaders/sequelize.instance");

const DRY = process.argv.includes("--dry-run");

async function main() {
  const startedAt = new Date();
  console.log(`[cleanup-expired-promos] start at ${startedAt.toISOString()} (DRY=${DRY})`);

  try {
    // 1) Diagnóstico: qué productos quedarían afectados
    const [rows] = await sequelize.query(
      `SELECT id, sku, name, promo_ends_at, promo_price
       FROM products
       WHERE is_promo = 1
         AND promo_ends_at IS NOT NULL
         AND promo_ends_at < NOW()
       ORDER BY promo_ends_at ASC`
    );

    if (!rows.length) {
      console.log("[cleanup-expired-promos] sin promos vencidas, nada que limpiar");
      process.exit(0);
    }

    console.log(`[cleanup-expired-promos] productos a limpiar: ${rows.length}`);
    for (const r of rows) {
      console.log(`  - #${r.id} ${r.sku} ${r.name} (vencida: ${r.promo_ends_at})`);
    }

    if (DRY) {
      console.log("[cleanup-expired-promos] DRY RUN — no se aplican cambios");
      process.exit(0);
    }

    // 2) UPDATE
    const [, meta] = await sequelize.query(
      `UPDATE products
       SET is_promo = 0,
           promo_price = NULL,
           promo_starts_at = NULL,
           promo_ends_at = NULL,
           promo_qty_threshold = NULL,
           promo_qty_discount = NULL,
           promo_qty_mode = NULL
       WHERE is_promo = 1
         AND promo_ends_at IS NOT NULL
         AND promo_ends_at < NOW()`
    );

    const affected = (meta && (meta.affectedRows ?? meta.rowCount)) || rows.length;
    console.log(`[cleanup-expired-promos] OK — filas actualizadas: ${affected}`);

    process.exit(0);
  } catch (e) {
    console.error("[cleanup-expired-promos] ERROR", e?.message || e);
    process.exit(1);
  } finally {
    try { await sequelize.close(); } catch {}
  }
}

main();
