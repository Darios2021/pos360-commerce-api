// src/migrations/runner.js
// Corre migraciones SQL al arrancar el servidor.
// Compatible con MySQL 5.7+ (sin IF NOT EXISTS en ADD COLUMN).
// Cada step define tabla, columna y definición por separado para
// poder verificar existencia vía INFORMATION_SCHEMA antes de alterar.

const { QueryTypes } = require("sequelize");

// Columnas a agregar si no existen
const columnSteps = [
  {
    id:     "cash_registers__closing_declared",
    table:  "cash_registers",
    column: "closing_declared",
    def:    "TEXT NULL COMMENT 'JSON montos declarados por medio de pago al cierre'",
  },
  {
    id:     "cash_registers__opening_ip",
    table:  "cash_registers",
    column: "opening_ip",
    def:    "VARCHAR(45) NULL COMMENT 'IP del cliente al abrir la caja'",
  },

  // ── Promociones de producto ──────────────────────────────────────────────
  // Nota: products.promo_price y products.is_promo ya existen.
  // Estos campos extienden la promo con ventana temporal y descuento por cantidad.
  {
    id:     "products__promo_starts_at",
    table:  "products",
    column: "promo_starts_at",
    def:    "DATETIME NULL COMMENT 'Inicio de promo por tiempo'",
  },
  {
    id:     "products__promo_ends_at",
    table:  "products",
    column: "promo_ends_at",
    def:    "DATETIME NULL COMMENT 'Fin de promo por tiempo'",
  },
  {
    id:     "products__promo_qty_threshold",
    table:  "products",
    column: "promo_qty_threshold",
    def:    "INT UNSIGNED NULL COMMENT 'Cantidad mínima para activar descuento por volumen'",
  },
  {
    id:     "products__promo_qty_discount",
    table:  "products",
    column: "promo_qty_discount",
    def:    "DECIMAL(12,2) NULL COMMENT 'Valor del descuento por volumen (monto o %)'",
  },
  {
    id:     "products__promo_qty_mode",
    table:  "products",
    column: "promo_qty_mode",
    def:    "VARCHAR(10) NULL COMMENT 'Modo descuento por volumen: amount | percent'",
  },
];

async function columnExists(sequelize, table, column) {
  try {
    const rows = await sequelize.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = :table
         AND COLUMN_NAME  = :column`,
      { type: QueryTypes.SELECT, replacements: { table, column } }
    );
    return Number(rows?.[0]?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

async function runStartupMigrations(sequelize) {
  for (const step of columnSteps) {
    try {
      const exists = await columnExists(sequelize, step.table, step.column);
      if (exists) {
        console.log(`ℹ️  [migration] ${step.id} — ya existe, skip`);
        continue;
      }
      await sequelize.query(
        `ALTER TABLE \`${step.table}\` ADD COLUMN \`${step.column}\` ${step.def}`,
        { type: QueryTypes.RAW }
      );
      console.log(`✅ [migration] ${step.id} — columna creada`);
    } catch (e) {
      // errno 1060 = Duplicate column name (race condition entre instancias)
      if (e?.original?.errno === 1060 || e?.message?.includes("Duplicate column")) {
        console.log(`ℹ️  [migration] ${step.id} — columna ya existe (race), skip`);
      } else {
        console.warn(`⚠️  [migration] ${step.id} falló:`, e.message);
      }
    }
  }
}

module.exports = { runStartupMigrations };
