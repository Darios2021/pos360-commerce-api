// src/migrations/runner.js
// Corre migraciones SQL al arrancar el servidor.
// Compatible con MySQL 5.7+ (sin IF NOT EXISTS en ADD COLUMN).
// Cada step define tabla, columna y definición por separado para
// poder verificar existencia vía INFORMATION_SCHEMA antes de alterar.

const { QueryTypes } = require("sequelize");

// Columnas a agregar si no existen
const columnSteps = [
  {
    id:     "sales__idempotency_key",
    table:  "sales",
    column: "idempotency_key",
    def:    "VARCHAR(64) NULL COMMENT 'Clave del intento de cobro: evita registrar dos veces la misma venta'",
  },
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

  // ── Presupuestos ─────────────────────────────────────────────────────────
  // Especificaciones tecnicas del renglon. Se precargan con la descripcion
  // del producto al agregarlo y quedan congeladas: si despues cambia la ficha
  // del catalogo, el presupuesto ya emitido no se mueve (misma regla que el
  // costo).
  {
    id:     "budget_items__specs",
    table:  "budget_items",
    column: "specs",
    def:    "TEXT NULL COMMENT 'Especificaciones tecnicas congeladas del renglon'",
  },
  // Que lista de precios se uso como base del renglon (sale/list/reseller/cost).
  // Se guarda para poder mostrarla y cambiarla despues renglon por renglon.
  {
    id:     "budget_items__price_source",
    table:  "budget_items",
    column: "price_source",
    def:    "VARCHAR(20) NULL COMMENT 'Lista de precios usada como base: sale|list|reseller|cost'",
  },
  // Trazabilidad de la cotizacion usada al presupuestar en USD. exchange_rate
  // ya existia; guardamos ademas de donde salio y de cuando, para que el
  // documento sea auditable y reimprimible con los mismos numeros.
  {
    id:     "budgets__fx_source",
    table:  "budgets",
    column: "fx_source",
    def:    "VARCHAR(120) NULL COMMENT 'Fuente de la cotizacion aplicada'",
  },
  {
    id:     "budgets__fx_date",
    table:  "budgets",
    column: "fx_date",
    def:    "DATETIME NULL COMMENT 'Fecha de la cotizacion aplicada'",
  },
  // Descuento: no se carga a mano, sale de los renglones con margen negativo.
  // Se guarda calculado para que el documento lo muestre al cliente sin que el
  // front tenga que rehacer la cuenta.
  {
    id:     "budgets__subtotal_gross",
    table:  "budgets",
    column: "subtotal_gross",
    def:    "DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Subtotal antes de descuento'",
  },
  {
    id:     "budgets__discount",
    table:  "budgets",
    column: "discount",
    def:    "DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'Descuento total (renglones con margen negativo)'",
  },
  // Vendedor y local congelados: el documento tiene que seguir diciendo quien
  // lo hizo y desde donde aunque despues cambien el usuario o la sucursal.
  {
    id:     "budgets__user_name",
    table:  "budgets",
    column: "user_name",
    def:    "VARCHAR(180) NULL COMMENT 'Vendedor que emitio el presupuesto (snapshot)'",
  },
  {
    id:     "budgets__branch_code",
    table:  "budgets",
    column: "branch_code",
    def:    "VARCHAR(10) NULL COMMENT 'Numero de local para la numeracion 001-00035 (snapshot)'",
  },
];

// ── Alta de producto: costo + % de ganancia → lista calculada ───────────
// Se guarda el porcentaje para que al editar se vea con qué ganancia se
// calculó la lista. NULL = la lista se cargó a mano.
columnSteps.push({
  id:     "products__markup_pct",
  table:  "products",
  column: "markup_pct",
  def:    "DECIMAL(7,2) NULL COMMENT 'Porcentaje de ganancia sobre el costo con el que se calculo la lista'",
});

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

  // ── Presupuestador ────────────────────────────────────────────────────────
  // Cabecera del presupuesto. El cliente puede venir de customers (FK) o
  // quedar congelado en los campos customer_* (presupuesto a nombre suelto).
  {
    id:     "budgets",
    table:  "budgets",
    sql: `
      CREATE TABLE IF NOT EXISTS budgets (
        id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        number           INT UNSIGNED NOT NULL COMMENT 'Numero visible del presupuesto (correlativo)',
        branch_id        BIGINT UNSIGNED NULL COMMENT 'Sucursal que lo emite',
        user_id          BIGINT UNSIGNED NULL COMMENT 'Usuario que lo creo',
        customer_id      BIGINT UNSIGNED NULL COMMENT 'FK customers (opcional)',
        customer_name    VARCHAR(180) NOT NULL DEFAULT 'Consumidor Final',
        customer_email   VARCHAR(180) NULL,
        customer_phone   VARCHAR(60) NULL,
        customer_address VARCHAR(255) NULL,
        customer_cuit    VARCHAR(20) NULL,
        status           ENUM('generado','en_proceso','entregado','vendido','no_venta') NOT NULL DEFAULT 'generado',
        currency         ENUM('ARS','USD') NOT NULL DEFAULT 'ARS',
        exchange_rate    DECIMAL(12,2) NOT NULL DEFAULT 1.00 COMMENT 'Cotizacion USD->ARS congelada al emitir',
        valid_until      DATE NULL COMMENT 'Vencimiento (por defecto +10 dias)',
        notes            TEXT NULL COMMENT 'Observaciones al pie',
        show_cost        TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Mostrar columnas costo/margen en pantalla',
        subtotal         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        vat_21           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        vat_105          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        total            DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        sale_id          BIGINT UNSIGNED NULL COMMENT 'Venta generada si se concreto',
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_budget_number (number),
        KEY ix_budget_customer (customer_id),
        KEY ix_budget_branch (branch_id),
        KEY ix_budget_status (status),
        KEY ix_budget_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Cabecera de presupuestos';
    `,
  },
  // Renglones. product_id NULL = renglon libre de texto.
  // El costo se congela al agregar: si despues cambia el precio del producto,
  // el presupuesto ya emitido no se mueve.
  {
    id:     "budget_items",
    table:  "budget_items",
    sql: `
      CREATE TABLE IF NOT EXISTS budget_items (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        budget_id     BIGINT UNSIGNED NOT NULL,
        product_id    BIGINT UNSIGNED NULL COMMENT 'NULL = renglon libre',
        sku           VARCHAR(80) NULL COMMENT 'Codigo congelado',
        description   VARCHAR(500) NOT NULL DEFAULT '',
        image_url     VARCHAR(500) NULL COMMENT 'Miniatura congelada',
        qty           DECIMAL(12,3) NOT NULL DEFAULT 1.000,
        cost          DECIMAL(14,4) NOT NULL DEFAULT 0.0000 COMMENT 'Costo real sin IVA',
        margin_pct    DECIMAL(7,2) NOT NULL DEFAULT 0.00 COMMENT 'Margen aplicado en %',
        vat_rate      DECIMAL(5,2) NOT NULL DEFAULT 21.00 COMMENT 'Alicuota IVA de la linea',
        unit_price    DECIMAL(14,4) NOT NULL DEFAULT 0.0000 COMMENT 'cost * (1 + margin/100), sin IVA',
        line_total    DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'unit_price * qty, sin IVA',
        sort_order    INT UNSIGNED NOT NULL DEFAULT 0,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY ix_bi_budget (budget_id),
        KEY ix_bi_product (product_id),
        CONSTRAINT fk_bi_budget FOREIGN KEY (budget_id) REFERENCES budgets (id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Renglones de presupuesto';
    `,
  },
];

// ── Alta de producto: proveedor, compra, unidad y stock mínimo ──────────
// Del formulario de artículos del sistema anterior. El stock mínimo es por
// producto (como allá): alimenta el aviso de stock bajo.
tableSteps.push({
  id:    "suppliers",
  table: "suppliers",
  sql: `
    CREATE TABLE IF NOT EXISTS suppliers (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name        VARCHAR(160) NOT NULL COMMENT 'Razon social o nombre del proveedor',
      tax_id      VARCHAR(20) NULL COMMENT 'CUIT',
      phone       VARCHAR(40) NULL,
      email       VARCHAR(160) NULL,
      is_active   TINYINT(1) NOT NULL DEFAULT 1,
      created_by  BIGINT UNSIGNED NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_suppliers_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Proveedores de mercaderia';
  `,
});
columnSteps.push(
  { id: "products__supplier_id",   table: "products", column: "supplier_id",   def: "BIGINT UNSIGNED NULL COMMENT 'Proveedor habitual (suppliers.id)'" },
  { id: "products__supplier_code", table: "products", column: "supplier_code", def: "VARCHAR(64) NULL COMMENT 'Codigo del articulo en el catalogo del proveedor'" },
  { id: "products__unit",          table: "products", column: "unit",          def: "VARCHAR(20) NULL COMMENT 'Unidad de medida: unidad, metro, caja, kg, litro, par'" },
  { id: "products__location",      table: "products", column: "location",      def: "VARCHAR(60) NULL COMMENT 'Ubicacion fisica (estante, deposito)'" },
  { id: "products__purchase_date", table: "products", column: "purchase_date", def: "DATE NULL COMMENT 'Fecha de la ultima compra'" },
  { id: "products__min_stock",     table: "products", column: "min_stock",     def: "DECIMAL(12,3) NULL COMMENT 'Stock minimo: por debajo, aviso de stock bajo'" },
);

// ── Alta de producto: costo en dólares y precio instalador ──────────────
// cost_currency = 'USD' → `cost` está en dólares y la lista se calcula con la
// cotización guardada en fx_rate (dólar oficial venta, la misma fuente que
// usan los presupuestos).
columnSteps.push(
  { id: "products__cost_currency",   table: "products", column: "cost_currency",   def: "VARCHAR(3) NULL COMMENT 'Moneda del costo: NULL o ARS = pesos, USD = dolares'" },
  { id: "products__fx_rate",         table: "products", column: "fx_rate",         def: "DECIMAL(12,4) NULL COMMENT 'Cotizacion usada para calcular la lista desde un costo en dolares'" },
  { id: "products__price_installer", table: "products", column: "price_installer", def: "DECIMAL(12,2) NULL COMMENT 'Precio para instaladores'" },
);

// Costo del producto al momento de la venta, en pesos (USD × cotización del
// producto). Lo usa el reporte "Ganancia y reparto": si mañana cambia el
// costo, lo vendido antes no cambia con él. NULL = venta anterior a la
// columna (el reporte la estima con el costo actual).
columnSteps.push({
  id:     "sale_items__unit_cost",
  table:  "sale_items",
  column: "unit_cost",
  def:    "DECIMAL(12,2) NULL COMMENT 'Costo unitario en pesos al momento de la venta'",
});

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
 * Define el orden visual de los métodos principales en el selector POS:
 *   1. Mercado Pago (kind=QR / MERCADOPAGO)  → sort_order=10
 *   2. Efectivo (kind=CASH)                  → sort_order=20
 *   El resto (tarjetas, crédito SJT) mantiene su sort_order actual
 *   (default 100) y aparece después.
 *
 * Idempotente: corre cada vez que arranca el server y solo actualiza
 * los valores que ya están en su lugar. Si el operador cambia el
 * sort_order desde el admin, este seed lo va a pisar al próximo boot
 * — si querés overridear, ajustá los números acá.
 */
async function ensurePosMethodsOrder(sequelize) {
  try {
    await sequelize.query(`
      UPDATE payment_methods
         SET sort_order = 10, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(kind) IN ('QR', 'MERCADOPAGO', 'MERCADO_PAGO')
         AND sort_order <> 10
    `);
    await sequelize.query(`
      UPDATE payment_methods
         SET sort_order = 20, updated_at = CURRENT_TIMESTAMP
       WHERE UPPER(kind) = 'CASH'
         AND sort_order <> 20
    `);
    console.log("ℹ️  [seed] sort_order normalizado: MP=10, CASH=20");
  } catch (e) {
    console.warn("⚠️  [seed] ensurePosMethodsOrder falló:", e.message);
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
         20, 0,
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

// Indices a crear si no existen. Son aparte de las columnas porque MySQL no
// tiene CREATE INDEX IF NOT EXISTS y hay que preguntarle a INFORMATION_SCHEMA.
const indexSteps = [
  {
    id:     "sales__uq_idempotency",
    table:  "sales",
    index:  "uq_sales_idempotency",
    sql:    "ALTER TABLE `sales` ADD UNIQUE KEY `uq_sales_idempotency` (`idempotency_key`)",
    // Sin este indice, dos cobros simultaneos con la misma clave pueden pasar
    // los dos el SELECT previo y crear dos ventas. Con el, el segundo choca y
    // el controller devuelve la venta del primero.
  },
];

async function indexExists(sequelize, table, index) {
  const filas = await sequelize.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :index
      LIMIT 1`,
    { replacements: { table, index }, type: QueryTypes.SELECT }
  );
  return Array.isArray(filas) && filas.length > 0;
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

  // Indices
  for (const step of indexSteps) {
    try {
      if (await indexExists(sequelize, step.table, step.index)) {
        console.log(`ℹ️  [migration] ${step.id} — indice ya existe, skip`);
        continue;
      }
      await sequelize.query(step.sql, { type: QueryTypes.RAW });
      console.log(`✅ [migration] ${step.id} — indice creado`);
    } catch (e) {
      // 1061 = Duplicate key name (carrera entre instancias)
      if (e?.original?.errno === 1061 || /Duplicate key name/i.test(e?.message || "")) {
        console.log(`ℹ️  [migration] ${step.id} — indice ya existe (race), skip`);
      } else {
        console.warn(`⚠️  [migration] ${step.id} falló:`, e.message);
      }
    }
  }

  // Data seeds idempotentes
  await ensureCashPaymentMethod(sequelize);
  await ensurePosMethodsOrder(sequelize);
}

module.exports = { runStartupMigrations };
