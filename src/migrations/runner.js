// src/migrations/runner.js
// Corre migraciones SQL seguras (IF NOT EXISTS) al arrancar el servidor.
// Agregar nuevas migraciones al array `steps` en orden.

const { QueryTypes } = require("sequelize");

const steps = [
  {
    id: "cash_registers__closing_declared",
    sql: `ALTER TABLE cash_registers
          ADD COLUMN IF NOT EXISTS closing_declared TEXT NULL
          COMMENT 'JSON con montos declarados por medio de pago al cierre'`,
  },
];

async function runStartupMigrations(sequelize) {
  for (const step of steps) {
    try {
      await sequelize.query(step.sql, { type: QueryTypes.RAW });
      console.log(`✅ [migration] ${step.id}`);
    } catch (e) {
      // Si la columna ya existe con motores que no soportan IF NOT EXISTS, ignorar
      if (e.message?.includes("Duplicate column")) {
        console.log(`ℹ️ [migration] ${step.id} — columna ya existe, skip`);
      } else {
        console.warn(`⚠️ [migration] ${step.id} falló:`, e.message);
      }
    }
  }
}

module.exports = { runStartupMigrations };
