#!/usr/bin/env node
// script/probar-conteos.js
//
// Prueba de punta a punta de los conteos de stock y de GET /products/by-code
// contra una MySQL DESCARTABLE. Arma las tablas base con Sequelize, crea las
// de conteos con el runner de migraciones, levanta la app real y la recorre
// por HTTP con tokens firmados con el JWT_SECRET de prueba.
//
// Uso (MySQL en docker, nunca una base real):
//   docker run -d --name conteos-prueba-db -e MYSQL_ROOT_PASSWORD=prueba \
//     -e MYSQL_DATABASE=pos_prueba -p 127.0.0.1:33991:3306 mysql:8.0
//   DB_HOST=127.0.0.1 DB_PORT=33991 DB_NAME=pos_prueba DB_USER=root DB_PASSWORD=prueba \
//   JWT_SECRET=prueba JWT_REFRESH_SECRET=prueba S3_ENDPOINT=http://127.0.0.1:9 \
//   S3_BUCKET=prueba S3_ACCESS_KEY=prueba S3_SECRET_KEY=prueba \
//   node script/probar-conteos.js
//   docker rm -f conteos-prueba-db
//
// Se niega a correr si la base no es local o su nombre no contiene "prueba":
// borra y recrea las tablas.
"use strict";

const host = String(process.env.DB_HOST || "");
const dbName = String(process.env.DB_NAME || "");
if (!["127.0.0.1", "localhost"].includes(host) || !/prueba/i.test(dbName)) {
  console.error("Sólo corre contra una MySQL local descartable (DB_HOST local y DB_NAME con 'prueba').");
  process.exit(2);
}

const http = require("http");
const jwt = require("jsonwebtoken");
const models = require("../src/models");
const { runStartupMigrations } = require("../src/migrations/runner");
const { createApp } = require("../src/app");

const { sequelize } = models;

let fallas = 0;
let pasos = 0;
function ok(cond, msg, extra) {
  pasos++;
  if (cond) console.log(`  ok   ${msg}`);
  else {
    fallas++;
    console.log(`  FALLA ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : "");
  }
}

async function q(sql, replacements = {}) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

async function prepararBase() {
  await q("SET FOREIGN_KEY_CHECKS = 0");
  const [tablas] = await sequelize.query("SHOW TABLES");
  for (const t of tablas) await q(`DROP TABLE \`${Object.values(t)[0]}\``);
  await q("SET FOREIGN_KEY_CHECKS = 1");

  // Tablas base con los modelos (sin FKs para no depender del orden).
  const orden = [
    "Branch", "User", "Role", "UserRole", "UserBranch", "Permission", "RolePermission",
    "Category", "Subcategory", "Product", "ProductImage", "Warehouse",
    "StockMovement", "StockMovementItem",
  ];
  const qi = sequelize.getQueryInterface();
  for (const n of orden) {
    const M = models[n];
    if (!M) { console.log(`  (modelo ${n} no cargado)`); continue; }
    const attrs = {};
    for (const [k, def] of Object.entries(M.rawAttributes)) {
      const { references, onDelete, onUpdate, ...rest } = def;
      attrs[def.field || k] = rest;
    }
    await qi.createTable(M.getTableName(), attrs);
    // Fechas obligatorias con default, para sembrar con SQL directo.
    for (const [col, def] of Object.entries(attrs)) {
      if (def.allowNull === false && def.defaultValue === undefined && def.type?.key === "DATE") {
        await q(`ALTER TABLE \`${M.getTableName()}\` MODIFY \`${col}\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      }
    }
  }
  // stock_balances y product_branches como en producción (UNIQUE para los upserts).
  await q(`CREATE TABLE stock_balances (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    warehouse_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    qty DECIMAL(14,3) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wh_prod (warehouse_id, product_id))`);
  await q(`CREATE TABLE product_branches (
    product_id BIGINT UNSIGNED NOT NULL,
    branch_id BIGINT UNSIGNED NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NULL,
    PRIMARY KEY (product_id, branch_id))`);

  // Tablas nuevas: las crea el runner, igual que al arrancar en el servidor.
  await runStartupMigrations(sequelize);
}

async function sembrar() {
  await q("INSERT INTO branches (id, code, name, is_active) VALUES (1,'CEN','Centro',1),(2,'SL','Santa Lucía',1)");
  await q(`INSERT INTO warehouses (id, branch_id, code, name, is_active) VALUES
    (10,1,'CEN-D','Depósito Centro',1),(20,2,'SL-D','Depósito Santa Lucía',1)`);
  await q("INSERT INTO roles (id, name) VALUES (1,'super_admin'),(2,'admin'),(3,'cajero')");
  const usuarios = [
    [1, "dueno@prueba", 2, 1],   // admin de Centro
    [2, "cajero@prueba", 3, 1],  // cajero de Centro
    [3, "cajero2@prueba", 3, 1], // otro cajero de Centro
    [4, "ajeno@prueba", 3, 2],   // cajero de Santa Lucía
  ];
  for (const [id, email, roleId, branchId] of usuarios) {
    await models.User.create({ id, email, username: email.split("@")[0], password_hash: "x", is_active: true, branch_id: branchId }, { validate: false })
      .catch(async () => q("INSERT INTO users (id, email, branch_id) VALUES (:id,:email,:b)", { id, email, b: branchId }));
    await q("INSERT INTO user_roles (user_id, role_id) VALUES (:id, :r)", { id, r: roleId });
    await q("INSERT INTO user_branches (user_id, branch_id) VALUES (:id, :b)", { id, b: branchId });
  }
  await q("INSERT INTO categories (id, name, is_active) VALUES (1,'Cargadores',1)");
  const productos = [
    // id, sku, barcode, code, name, activo, track_stock
    [101, "CAR-020", "7790000000101", "P00101", "Cargador 20 W USB-C", 1, 1],
    [102, "CAB-001", "7790000000102", "P00102", "Cable USB-C 1 m", 1, 1],
    [103, "AUR-010", "0012345678905", "P00103", "Auricular inactivo", 0, 1],
    [104, "SERV-01", null, "P00104", "Servicio sin stock", 1, 0],
    [105, "SL-ONLY", "7790000000105", "P00105", "Sólo Santa Lucía", 1, 1],
  ];
  for (const [id, sku, barcode, code, name, act, track] of productos) {
    await q(`INSERT INTO products (id, branch_id, sku, barcode, code, name, is_active, track_stock, category_id, created_at, updated_at)
             VALUES (:id, 1, :sku, :barcode, :code, :name, :act, :track, 1, NOW(), NOW())`,
      { id, sku, barcode, code, name, act, track });
  }
  await q(`INSERT INTO product_branches (product_id, branch_id, is_active) VALUES
    (101,1,1),(102,1,1),(103,1,1),(104,1,1),(105,2,1)`);
  // Stock inicial del depósito Centro: 101 -> 10, 102 -> 5, 103 -> 2
  await q("INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (10,101,10),(10,102,5),(10,103,2),(20,101,7)");
}

function token(id, roles) {
  return jwt.sign({ sub: id, roles }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

async function main() {
  console.log("Preparando base descartable…");
  await prepararBase();
  await sembrar();

  const tablas = await q("SHOW TABLES LIKE 'stock_count%'");
  ok(tablas.length === 2, "el runner creó stock_counts y stock_count_items", tablas);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const T = {
    admin: token(1, ["admin"]),
    cajero: token(2, ["cajero"]),
    cajero2: token(3, ["cajero"]),
    ajeno: token(4, ["cajero"]),
  };
  async function api(quien, method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${T[quien]}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, body: json };
  }
  const stock = async (wh, pid) => Number((await q("SELECT qty FROM stock_balances WHERE warehouse_id=:wh AND product_id=:pid", { wh, pid }))[0]?.qty ?? NaN);

  try {
    // ── by-code ────────────────────────────────────────────────────────────
    console.log("\nGET /products/by-code");
    let r = await api("cajero", "GET", "/products/by-code/7790000000101");
    ok(r.status === 200 && r.body?.data?.id === 101, "barcode exacto devuelve el producto", r.body);
    const porId = await api("cajero", "GET", "/products/101");
    ok(JSON.stringify(Object.keys(r.body?.data || {}).sort()) === JSON.stringify(Object.keys(porId.body?.data || {}).sort()),
      "mismo formato que GET /products/:id");
    r = await api("cajero", "GET", "/products/by-code/CAB-001");
    ok(r.status === 200 && r.body?.data?.id === 102, "por SKU");
    r = await api("cajero", "GET", "/products/by-code/P00101");
    ok(r.status === 200 && r.body?.data?.id === 101, "por code");
    r = await api("cajero", "GET", "/products/by-code/0012345678905");
    ok(r.status === 200 && r.body?.data?.id === 103, "incluye inactivos y respeta ceros a la izquierda");
    r = await api("cajero", "GET", "/products/by-code/779000000010");
    ok(r.status === 404 && r.body?.code === "NOT_FOUND", "código parcial no coincide (404)", r);
    r = await api("cajero", "GET", "/products/by-code/7790000000105");
    ok(r.status === 403, "producto no habilitado en la sucursal del cajero: 403", r);

    // ── conteos ────────────────────────────────────────────────────────────
    console.log("\nConteos: crear, cargar, enviar, aplicar");
    r = await api("cajero", "POST", "/stock/counts", {
      motivo: "Conteo de góndola",
      items: [{ product_id: 101, counted_qty: 8 }, { product_id: 102, counted_qty: "5" }],
    });
    ok(r.status === 201 && r.body?.count?.status === "draft", "cajero crea un borrador (201)", r.body);
    const c1 = r.body?.count;
    ok(c1?.warehouse_id === 10, "sin warehouse_id usa el depósito de la sucursal activa");
    ok(/^CON-\d{4}-0+\d+$/.test(c1?.number || ""), "número CON-AAAA-NNNNNN", c1?.number);
    const it101 = c1?.items?.find((i) => i.product_id === 101);
    ok(it101?.system_qty === "10.000" && it101?.diff_qty === "-2.000", "abierto: system_qty es el stock actual y diff con signo", it101);

    r = await api("cajero2", "PUT", `/stock/counts/${c1.id}`, { mode: "sumar", items: [{ product_id: 101, counted_qty: 1 }] });
    ok(r.status === 200, "otro cajero de la sucursal suma +1", r.body);
    await Promise.all([1, 2, 3].map(() => api("cajero", "PUT", `/stock/counts/${c1.id}`, { mode: "sumar", items: [{ product_id: 101, counted_qty: 1 }] })));
    r = await api("cajero", "GET", `/stock/counts/${c1.id}`);
    ok(r.body?.count?.items?.find((i) => i.product_id === 101)?.counted_qty === "12.000", "sumas simultáneas no se pisan (8+1+3 = 12)", r.body?.count?.items);

    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 101, counted_qty: 7 }, { product_id: 103, counted_qty: 0 }] });
    const its = r.body?.count?.items || [];
    ok(its.find((i) => i.product_id === 101)?.counted_qty === "7.000" && its.length === 3, "reemplazar fija la cantidad y agrega renglones", its);

    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { mode: "sumar", items: [{ product_id: 103, counted_qty: -1 }] });
    ok(r.status === 400 && r.body?.code === "QTY_INVALID", "sumar no deja cantidades negativas", r.body);
    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 104, counted_qty: 1 }] });
    ok(r.status === 422 && r.body?.code === "PRODUCT_NO_STOCK_TRACK", "producto sin control de stock: 422", r.body);
    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 999, counted_qty: 1 }] });
    ok(r.status === 404 && r.body?.code === "PRODUCT_NOT_FOUND", "producto inexistente: 404", r.body);
    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 105, counted_qty: 3 }], remove_product_ids: [105] });
    ok(r.status === 200 && !r.body?.count?.items?.some((i) => i.product_id === 105), "remove_product_ids quita renglones");

    r = await api("ajeno", "GET", `/stock/counts/${c1.id}`);
    ok(r.status === 403 && r.body?.code === "FORBIDDEN_BRANCH", "cajero de otra sucursal no lo ve", r.body);
    r = await api("ajeno", "POST", "/stock/counts", { warehouse_id: 10, items: [] });
    ok(r.status === 403, "ni puede crear en un depósito ajeno", r.body);

    r = await api("cajero", "POST", `/stock/counts/${c1.id}/apply`);
    ok(r.status === 403 && r.body?.code === "FORBIDDEN", "cajero NO aplica (403)", r.body);
    ok(await stock(10, 101) === 10, "el stock no cambió tras el intento del cajero");

    r = await api("cajero", "POST", `/stock/counts/${c1.id}/submit`, { motivo: "Conteo de góndola, pasillo 3" });
    ok(r.status === 200 && r.body?.count?.status === "pending" && r.body?.count?.submitted_by === 2, "cajero envía para aprobar (pending)", r.body);
    r = await api("cajero", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 101, counted_qty: 1 }] });
    ok(r.status === 403, "cajero ya no edita un conteo pendiente", r.body);
    r = await api("cajero", "POST", `/stock/counts/${c1.id}/submit`);
    ok(r.status === 422 && r.body?.code === "COUNT_NOT_OPEN", "no se envía dos veces", r.body);

    r = await api("admin", "GET", "/stock/counts?status=pending");
    ok(r.status === 200 && r.body?.counts?.length === 1 && r.body?.counts?.[0]?.items_count === 3 && r.body?.count_by_status?.pending === 1,
      "lista por estado con items_count y count_by_status", r.body);

    // Antes de aplicar, una venta mueve el stock: la diferencia se calcula contra el stock del momento.
    await q("UPDATE stock_balances SET qty = 9 WHERE warehouse_id = 10 AND product_id = 101");

    r = await api("admin", "POST", `/stock/counts/${c1.id}/apply`);
    ok(r.status === 200 && r.body?.count?.status === "applied" && r.body?.count?.applied_by === 1, "admin aplica (applied)", r.body);
    ok(Array.isArray(r.body?.movements) && r.body.movements.length === 2, "dos movimientos: 101 y 103 (102 sin diferencia)", r.body?.movements);
    ok(await stock(10, 101) === 7 && await stock(10, 102) === 5 && await stock(10, 103) === 0, "stock fijado en lo contado");
    ok(await stock(20, 101) === 7, "otro depósito intacto");

    const aplicado = r.body?.count;
    const a101 = aplicado?.items?.find((i) => i.product_id === 101);
    const a103 = aplicado?.items?.find((i) => i.product_id === 103);
    ok(a101?.system_qty === "9.000" && a101?.diff_qty === "-2.000", "system_qty congelado al aplicar (9) y diff -2", a101);
    ok(a103?.system_qty === "2.000" && a103?.diff_qty === "-2.000", "103: 2 -> 0", a103);

    const movs = await q(`SELECT m.id, m.type, m.warehouse_id, m.ref_type, m.ref_id, m.note, m.created_by, i.product_id, i.qty
                          FROM stock_movements m JOIN stock_movement_items i ON i.movement_id = m.id
                          WHERE m.ref_type = 'stock_count' AND m.ref_id = :id ORDER BY i.product_id`, { id: String(c1.id) });
    ok(movs.length === 2 && movs.every((m) => m.type === "adjustment" && Number(m.warehouse_id) === 10 && Number(m.created_by) === 1),
      "movimientos adjustment del depósito, autor = quien aplica", movs);
    ok(Number(movs[0]?.qty) === 2 && /Conteo de góndola, pasillo 3/.test(movs[0]?.note) && /9 -> 7 \(-2\)/.test(movs[0]?.note),
      "ítem con la diferencia y nota con motivo y signo", movs[0]);

    r = await api("admin", "POST", `/stock/counts/${c1.id}/apply`);
    ok(r.status === 422 && r.body?.code === "COUNT_NOT_OPEN", "no se aplica dos veces", r.body);
    ok(await stock(10, 101) === 7, "y el stock no se movió");
    r = await api("admin", "PUT", `/stock/counts/${c1.id}`, { items: [{ product_id: 101, counted_qty: 1 }] });
    ok(r.status === 422, "un conteo aplicado no se edita", r.body);
    await q("UPDATE stock_balances SET qty = 50 WHERE warehouse_id = 10 AND product_id = 101");
    r = await api("admin", "GET", `/stock/counts/${c1.id}`);
    ok(r.body?.count?.items?.find((i) => i.product_id === 101)?.system_qty === "9.000", "aplicado: system_qty no sigue al stock vivo");

    console.log("\nAdmin aplica directo desde borrador; producto nuevo en el depósito");
    r = await api("admin", "POST", "/stock/counts", { warehouse_id: 10, items: [{ product_id: 102, counted_qty: 6.5 }] });
    const c2 = r.body?.count;
    r = await api("admin", "POST", `/stock/counts/${c2.id}/apply`);
    ok(r.status === 400 && r.body?.code === "MOTIVO_REQUIRED", "sin motivo no aplica", r.body);
    await q("DELETE FROM stock_balances WHERE warehouse_id = 10 AND product_id = 102");
    r = await api("admin", "POST", `/stock/counts/${c2.id}/apply`, { motivo: "Ingreso sin registrar" });
    ok(r.status === 200 && r.body?.count?.status === "applied", "aplica desde draft con motivo en el cuerpo", r.body);
    ok(await stock(10, 102) === 6.5, "crea el saldo que no existía (decimales)");
    ok(r.body?.count?.items?.[0]?.diff_qty === "6.500", "diff positiva +6.5", r.body?.count?.items);

    console.log("\nCancelar");
    r = await api("cajero", "POST", "/stock/counts", { items: [] });
    const c3 = r.body?.count;
    r = await api("cajero", "POST", `/stock/counts/${c3.id}/submit`, { motivo: "x" });
    ok(r.status === 422 && r.body?.code === "COUNT_EMPTY", "no se envía vacío", r.body);
    r = await api("cajero2", "POST", `/stock/counts/${c3.id}/cancel`);
    ok(r.status === 403, "otro cajero no cancela un conteo ajeno", r.body);
    r = await api("cajero", "POST", `/stock/counts/${c3.id}/cancel`);
    ok(r.status === 200 && r.body?.count?.status === "cancelled", "quien lo creó lo cancela", r.body);
    r = await api("admin", "POST", `/stock/counts/${c3.id}/apply`, { motivo: "x" });
    ok(r.status === 422, "un cancelado no se aplica", r.body);

    r = await api("cajero", "GET", "/stock/counts");
    ok(r.body?.total_all === 3 && r.body?.count_by_status?.applied === 2 && r.body?.count_by_status?.cancelled === 1,
      "count_by_status del ámbito", r.body?.count_by_status);
    r = await api("ajeno", "GET", "/stock/counts");
    ok(r.status === 200 && r.body?.total_all === 0, "otra sucursal no ve conteos de Centro", r.body);
  } finally {
    server.close();
    await sequelize.close();
  }

  console.log(`\n${pasos - fallas}/${pasos} verificaciones ok`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
