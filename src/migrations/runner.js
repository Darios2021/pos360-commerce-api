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
  // Estos campos extienden la promo con precio especial, ventana temporal
  // y descuento por cantidad. is_promo ya existía en DB.
  {
    id:     "products__promo_price",
    table:  "products",
    column: "promo_price",
    def:    "DECIMAL(12,2) NULL COMMENT 'Precio promocional (reemplaza al de lista cuando la promo está vigente)'",
  },
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

  // ── Kits / combos ────────────────────────────────────────────────────────
  // Un kit es un producto que agrupa otros productos. Se vende como un solo
  // item con su precio fijo, pero al confirmar la venta se descuenta stock
  // de cada componente individualmente.
  {
    id:     "products__is_kit",
    table:  "products",
    column: "is_kit",
    def:    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Indica si el producto es un kit que agrupa otros productos'",
  },

  // ── Shop customers: perfil completo + password ──────────────────────────
  // Para forzar a los clientes (incluso los logueados con Google) a completar
  // sus datos de contacto y elegir una password antes de comprar.
  // Default 0 → todos los registros existentes quedan marcados como incompletos
  // y deberán completar el perfil la próxima vez que entren al shop.
  {
    id:     "ecom_customers__profile_completed",
    table:  "ecom_customers",
    column: "profile_completed",
    def:    "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Cliente completó nombre/apellido/teléfono y password real'",
  },
  {
    id:     "ecom_customers__password_hash",
    table:  "ecom_customers",
    column: "password_hash",
    def:    "VARCHAR(255) NULL COMMENT 'Hash bcrypt de la password elegida por el cliente'",
  },
  {
    id:     "ecom_customers__picture_url",
    table:  "ecom_customers",
    column: "picture_url",
    def:    "VARCHAR(500) NULL COMMENT 'URL de la foto de perfil (Google picture)'",
  },

  // ── Shop orders: timestamp de retiro/entrega ────────────────────────────
  // Se setea cuando el admin marca el pedido como "delivered" o "picked_up".
  // Permite mostrar al cliente cuándo retiró su compra.
  {
    id:     "ecom_orders__picked_up_at",
    table:  "ecom_orders",
    column: "picked_up_at",
    def:    "TIMESTAMP NULL DEFAULT NULL COMMENT 'Cuándo el cliente retiró/recibió el pedido'",
  },
  {
    id:     "ecom_orders__ready_at",
    table:  "ecom_orders",
    column: "ready_at",
    def:    "TIMESTAMP NULL DEFAULT NULL COMMENT 'Cuándo el pedido quedó listo para retirar/enviar'",
  },
  {
    id:     "ecom_orders__processing_at",
    table:  "ecom_orders",
    column: "processing_at",
    def:    "TIMESTAMP NULL DEFAULT NULL COMMENT 'Cuándo el pedido empezó a prepararse'",
  },
];

// Tablas a crear si no existen
const tableSteps = [
  {
    id:     "product_kit_items",
    table:  "product_kit_items",
    sql: `
      CREATE TABLE IF NOT EXISTS product_kit_items (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        kit_id          BIGINT UNSIGNED NOT NULL COMMENT 'FK al producto-kit (products.id)',
        component_id    BIGINT UNSIGNED NOT NULL COMMENT 'FK al producto componente (products.id)',
        qty             DECIMAL(12,3) NOT NULL DEFAULT 1.000 COMMENT 'Cantidad del componente en el kit',
        sort_order      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Orden de visualización',
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_kit_component (kit_id, component_id),
        KEY ix_kit_id (kit_id),
        KEY ix_component_id (component_id),
        CONSTRAINT fk_pki_kit FOREIGN KEY (kit_id) REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_pki_component FOREIGN KEY (component_id) REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Componentes de un kit/combo de productos';
    `,
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

async function tableExists(sequelize, table) {
  try {
    const rows = await sequelize.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = :table`,
      { type: QueryTypes.SELECT, replacements: { table } }
    );
    return Number(rows?.[0]?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Asegura que exista un método de pago "Efectivo" activo.
 * - Si hay un row con kind=CASH activo → no hace nada.
 * - Si hay un row con kind=CASH inactivo → lo activa.
 * - Si no hay ninguno → lo crea con defaults razonables (CASH, vuelto on,
 *   counts_as_cash_in_register, sin recargos, todos los flujos habilitados).
 *
 * Esto previene que el POS quede sin método de pago en efectivo si
 * alguien lo desactiva o borra accidentalmente.
 */
async function ensureCashPaymentMethod(sequelize) {
  try {
    // 1) Hay alguno activo?
    const [activeRows] = await sequelize.query(
      `SELECT id FROM payment_methods
       WHERE UPPER(kind) = 'CASH' AND is_active = 1
       LIMIT 1`
    );
    if (activeRows && activeRows.length) {
      console.log(`ℹ️  [seed] Método CASH ya existe activo (id=${activeRows[0].id})`);
      return;
    }

    // 2) Hay alguno inactivo? Activarlo.
    const [inactiveRows] = await sequelize.query(
      `SELECT id FROM payment_methods
       WHERE UPPER(kind) = 'CASH'
       ORDER BY id ASC LIMIT 1`
    );
    if (inactiveRows && inactiveRows.length) {
      const id = inactiveRows[0].id;
      await sequelize.query(
        `UPDATE payment_methods SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
        { replacements: { id } }
      );
      console.log(`✅ [seed] Método CASH (id=${id}) reactivado`);
      return;
    }

    // 3) No existe. Crear desde cero.
    await sequelize.query(`
      INSERT INTO payment_methods
        (code, name, display_name, kind, provider_code,
         is_active, is_default, is_system, is_featured,
         sort_order, allow_mixed,
         only_pos, only_ecom, only_backoffice,
         allows_change, counts_as_cash_in_register, impacts_cash_register,
         register_group, settlement_delay_days,
         pricing_mode, surcharge_percent, surcharge_fixed_amount,
         rounding_mode,
         supports_installments, min_installments, max_installments, default_installments,
         installment_pricing_mode, installment_surcharge_percent,
         input_schema_json, meta,
         created_at, updated_at)
      VALUES
        ('cash', 'Efectivo', 'Efectivo', 'CASH', 'cash',
         1, 1, 1, 1,
         10, 0,
         0, 0, 0,
         1, 1, 1,
         'CASH', 0,
         'SALE_PRICE', 0, 0,
         'NONE',
         0, 1, 1, 1,
         'SAME_AS_BASE', 0,
         '{"fields":[]}', '{}',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    console.log(`✅ [seed] Método "Efectivo" (CASH) creado de cero`);
  } catch (e) {
    console.warn(`⚠️  [seed] ensureCashPaymentMethod falló:`, e.message);
  }
}

async function runStartupMigrations(sequelize) {
  // Tablas nuevas primero (las columnas pueden depender de FKs)
  for (const step of tableSteps) {
    try {
      const exists = await tableExists(sequelize, step.table);
      if (exists) {
        console.log(`ℹ️  [migration] ${step.id} — tabla ya existe, skip`);
        continue;
      }
      await sequelize.query(step.sql, { type: QueryTypes.RAW });
      console.log(`✅ [migration] ${step.id} — tabla creada`);
    } catch (e) {
      console.warn(`⚠️  [migration] ${step.id} falló:`, e.message);
    }
  }

  // Columnas
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

  // Data seeds idempotentes
  await ensureCashPaymentMethod(sequelize);
}

module.exports = { runStartupMigrations };
