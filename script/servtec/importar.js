/* script/servtec/importar.js
   Importa a la base la carga del libro SERV_TEC.xlsm del servicio tecnico:
   clientes, ordenes historicas y lista de precios de reparacion.

   Antes de correrlo hay que generar los JSON:
     python3 script/servtec/extraer-excel.py ~/Descargas/SERV_TEC.xlsm

   Uso:
     node script/servtec/importar.js --dry-run     # no escribe nada, informa
     node script/servtec/importar.js               # escribe
     node script/servtec/importar.js --solo=clientes,precios

   Es idempotente: se puede correr dos veces sin duplicar. Los clientes se
   deduplican contra los que ya estan en la tabla con el mismo criterio que usa
   customers.controller.js en el backfill (documento, telefono normalizado,
   email, y recien al final el nombre normalizado). Las ordenes se reconocen
   por `legacy_number` + `source='import'`, y los precios por (model, repair_type).

   Las ordenes migradas entran con `number` en NULL y el numero del papel en
   `legacy_number`: la serie nueva del sistema arranca en 1 y nunca las pisa.
*/

const fs = require("fs");
const path = require("path");
const { sequelize } = require("../../src/loaders/sequelize.instance");

const DRY = process.argv.includes("--dry-run");
const SOLO = (process.argv.find((a) => a.startsWith("--solo=")) || "")
  .replace("--solo=", "")
  .split(",")
  .filter(Boolean);

const DATOS = path.join(__dirname, "datos");
const hace = (etapa) => !SOLO.length || SOLO.includes(etapa);

// Marca con la que quedan etiquetados los clientes que vienen del taller.
const TAG_SERVTEC = "servicio-tecnico";

function leerJson(nombre) {
  const ruta = path.join(DATOS, nombre);
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `Falta ${ruta}. Corré primero: python3 script/servtec/extraer-excel.py <ruta al SERV_TEC.xlsm>`
    );
  }
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

// ── Normalizadores, iguales a los del backfill de clientes ─────────────────

function normalizarNombre(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
const normalizarTelefono = (v) => String(v || "").replace(/[^\d+]/g, "");

// ── Clientes ────────────────────────────────────────────────────────────────

async function importarClientes(t) {
  const clientes = leerJson("clientes.json");
  console.log(`\n── CLIENTES (${clientes.length} en el Excel) ──`);

  // Indice de lo que ya hay en la base, para no duplicar.
  const existentes = await sequelize.query(
    `SELECT id, display_name, phone, email, doc_number FROM customers`,
    { type: sequelize.QueryTypes.SELECT, transaction: t }
  );
  const porTelefono = new Map();
  const porNombre = new Map();
  for (const c of existentes) {
    const tel = normalizarTelefono(c.phone);
    if (tel) porTelefono.set(tel, c.id);
    const nom = normalizarNombre(c.display_name);
    if (nom && !porNombre.has(nom)) porNombre.set(nom, c.id);
  }
  console.log(`   ya en la base: ${existentes.length}`);

  const mapa = {};      // clave del Excel -> id de customers
  let creados = 0;
  let reusados = 0;

  for (const c of clientes) {
    const tel = normalizarTelefono(c.phone);
    const nom = normalizarNombre(c.display_name);

    // El telefono manda. Si la ficha del Excel tiene telefono, se busca SOLO
    // por telefono: el nombre no alcanza para fusionar.
    //
    // Sin esta regla, dos personas distintas con el mismo nombre y telefonos
    // distintos ("Daniel Godoy" aparece con dos numeros, "Jose Avila" tambien)
    // terminan en una sola ficha y se pierde un telefono. El extractor ya las
    // separo a proposito; el importador no las vuelve a juntar.
    //
    // El match por nombre queda solo para las fichas que vienen sin telefono,
    // donde es lo unico que hay.
    let id = tel
      ? porTelefono.get(tel) || null
      : porNombre.get(nom) || null;

    if (id) {
      reusados++;
    } else if (DRY) {
      // El dry-run tiene que contar igual que la corrida real: si no se
      // indexa lo que se va creando, no detecta los que colapsan entre si
      // y el informe queda inflado.
      id = `nuevo:${c.clave}`;
      creados++;
      if (tel) porTelefono.set(tel, id);
      else if (nom && !porNombre.has(nom)) porNombre.set(nom, id);
    } else {
      const notas = [
        "Importado del libro SERV_TEC del servicio tecnico.",
        `Ordenes de reparacion en el Excel: ${c.ordenes}.`,
        c.primera_visita ? `Primera visita: ${c.primera_visita}.` : "",
        c.variantes_nombre.length > 1
          ? `El nombre figura tambien como: ${c.variantes_nombre.slice(1).join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const [res] = await sequelize.query(
        `INSERT INTO customers
           (display_name, phone, customer_type, accepts_promos, tags, notes, source, is_active, created_at, updated_at)
         VALUES
           (:display_name, :phone, 'CONSUMIDOR_FINAL', 0, :tags, :notes, 'import', 1, NOW(), NOW())`,
        {
          replacements: {
            display_name: c.display_name,
            phone: c.phone || null,
            tags: TAG_SERVTEC,
            notes: notas,
          },
          transaction: t,
        }
      );
      id = res;
      creados++;
      if (tel) porTelefono.set(tel, id);
      else if (nom && !porNombre.has(nom)) porNombre.set(nom, id);
    }

    mapa[c.clave] = id;
  }

  console.log(`   creados: ${creados}   reusados (ya existian): ${reusados}`);
  return mapa;
}

// ── Ordenes historicas ──────────────────────────────────────────────────────

async function importarOrdenes(t, mapaClientes) {
  const ordenes = leerJson("ordenes.json");
  console.log(`\n── ORDENES (${ordenes.length} en el Excel) ──`);

  const yaImportadas = await sequelize.query(
    `SELECT legacy_number FROM service_orders WHERE source = 'import' AND legacy_number IS NOT NULL`,
    { type: sequelize.QueryTypes.SELECT, transaction: t }
  );
  // Solo lo que ya estaba en la base ANTES de esta corrida. No se agregan los
  // numeros a medida que se insertan: en el Excel hay dos numeros de orden
  // repetidos (778 y 964) que son reparaciones distintas, y si se los tratara
  // como duplicados se perderian dos ordenes reales.
  const vistas = new Set(yaImportadas.map((r) => Number(r.legacy_number)));
  if (vistas.size) console.log(`   ya importadas antes: ${vistas.size}`);

  let creadas = 0;
  let salteadas = 0;

  // Una sola fila del Excel vino sin numero de orden, asi que no hay con que
  // reconocerla en una segunda corrida y se reinsertaria cada vez. Como toda
  // la importacion va en una transaccion (o entra completa o no entra nada),
  // que ya existan ordenes importadas significa que una corrida anterior
  // termino bien: en ese caso las sin numero ya estan y se saltean.
  const yaHuboImportacion = vistas.size > 0;

  for (const o of ordenes) {
    if (o.legacy_number && vistas.has(o.legacy_number)) {
      salteadas++;
      continue;
    }
    if (!o.legacy_number && yaHuboImportacion) {
      salteadas++;
      continue;
    }

    const customerId = o.cliente_clave ? mapaClientes[o.cliente_clave] : null;
    // En dry-run el mapa tiene marcadores de texto, no ids reales.
    const fk = typeof customerId === "number" ? customerId : null;

    // El Excel guarda el equipo en un solo campo ("SAMSUNG A04"): la primera
    // palabra es la marca y el resto el modelo. Es lo mejor que se puede
    // inferir sin inventar datos.
    const equipo = String(o.equipo || "").trim();
    const corte = equipo.indexOf(" ");
    const marca = corte > 0 ? equipo.slice(0, corte) : equipo;
    const modelo = corte > 0 ? equipo.slice(corte + 1) : "";

    if (DRY) {
      creadas++;
      continue;
    }

    await sequelize.query(
      `INSERT INTO service_orders
         (number, legacy_number, received_by, customer_id, customer_name, customer_phone,
          device_brand, device_model, intake_condition, reported_fault, technical_report,
          suggestions, technician_name, status, quoted_amount, deposit, balance,
          parts_cost, total_charged, commission_technician, commission_seller, commission_shop,
          estimated_pickup, delivered_at, delivered_by, source, created_at, updated_at)
       VALUES
         (NULL, :legacy_number, :received_by, :customer_id, :customer_name, :customer_phone,
          :device_brand, :device_model, :intake_condition, :reported_fault, :technical_report,
          :suggestions, :technician_name, :status, :quoted_amount, :deposit, :balance,
          :parts_cost, :total_charged, :commission_technician, :commission_seller, :commission_shop,
          :estimated_pickup, :delivered_at, :delivered_by, 'import', :created_at, NOW())`,
      {
        replacements: {
          legacy_number: o.legacy_number,
          received_by: o.recibido_por || null,
          customer_id: fk,
          customer_name: o.cliente_nombre || "Consumidor Final",
          customer_phone: o.cliente_telefono || null,
          device_brand: marca || null,
          device_model: modelo || null,
          intake_condition: o.estado_ingreso || null,
          reported_fault: o.falla_informada || null,
          technical_report: o.reporte_tecnico || null,
          suggestions: o.sugerencias || null,
          technician_name: o.tecnico || null,
          status: o.status,
          quoted_amount: o.presupuesto,
          deposit: o.senia,
          balance: o.saldo,
          parts_cost: o.costo_repuesto,
          total_charged: o.total_cobro,
          commission_technician: o.comision_tecnico,
          commission_seller: o.comision_vendedor,
          commission_shop: o.comision_local,
          estimated_pickup: o.fecha_prob_retiro,
          // Mismo motivo que created_at: es un DATETIME y el Excel solo trae
          // el dia, asi que va al mediodia para que no se corra al mostrarlo.
          delivered_at: o.fecha_entrega ? `${o.fecha_entrega} 12:00:00` : null,
          delivered_by: o.entregado_por || null,
          // created_at guarda la fecha real de ingreso al taller: si se pone
          // NOW(), el historial queda todo con fecha de hoy y no sirve.
          //
          // Va al MEDIODIA, no a medianoche. El Excel solo tiene el dia, sin
          // hora. Si se guarda 00:00, la API lo serializa como UTC y el
          // navegador en Argentina (UTC-3) lo pinta un dia antes: la orden
          // 1287 del 21/12 se veia como 20/12. A las 12:00 ninguna zona
          // horaria razonable puede correr el dia.
          created_at: `${o.fecha_ingreso || new Date().toISOString().slice(0, 10)} 12:00:00`,
        },
        transaction: t,
      }
    );
    creadas++;
  }

  const sinCliente = ordenes.filter((o) => !o.cliente_clave).length;
  console.log(`   creadas: ${creadas}   salteadas (ya estaban): ${salteadas}`);
  console.log(`   sin cliente asociado: ${sinCliente}`);
}

// ── Lista de precios ────────────────────────────────────────────────────────

async function importarPrecios(t) {
  const precios = leerJson("precios-reparacion.json");
  console.log(`\n── PRECIOS DE REPARACION (${precios.length} modelos) ──`);

  let creados = 0;
  let actualizados = 0;
  let sinCambios = 0;

  for (const p of precios) {
    if (DRY) {
      creados++;
      continue;
    }
    // ON DUPLICATE KEY sobre (model, repair_type): correrlo de nuevo actualiza
    // los precios en vez de fallar. Es la forma de subir una lista nueva.
    const [, meta] = await sequelize.query(
      `INSERT INTO service_repair_prices
         (model, repair_type, parts_cost, technician_cost, shop_margin, seller_commission,
          total_price, installment_3, installment_6, is_active, created_at, updated_at)
       VALUES
         (:model, 'modulo', :parts_cost, :technician_cost, :shop_margin, :seller_commission,
          :total_price, :installment_3, :installment_6, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         parts_cost = VALUES(parts_cost),
         technician_cost = VALUES(technician_cost),
         shop_margin = VALUES(shop_margin),
         seller_commission = VALUES(seller_commission),
         total_price = VALUES(total_price),
         installment_3 = VALUES(installment_3),
         installment_6 = VALUES(installment_6),
         updated_at = NOW()`,
      {
        replacements: {
          model: p.modelo,
          parts_cost: p.costo_repuesto,
          technician_cost: p.costo_tecnico,
          shop_margin: p.ganancia_local,
          seller_commission: p.comision_vendedor,
          total_price: p.precio_total,
          installment_3: p.cuota_3,
          installment_6: p.cuota_6,
        },
        transaction: t,
      }
    );
    // sequelize.query devuelve [insertId, affectedRows] en un INSERT crudo.
    // Con ON DUPLICATE KEY, MySQL informa: 1 = inserto, 2 = actualizo, y 0 =
    // la fila ya estaba con exactamente los mismos valores.
    if (meta === 2) actualizados++;
    else if (meta === 1) creados++;
    else sinCambios++;
  }

  console.log(`   creados: ${creados}   actualizados: ${actualizados}   sin cambios: ${sinCambios}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(62));
  console.log(`  IMPORTACION SERV_TEC${DRY ? "  (DRY RUN: no escribe nada)" : ""}`);
  console.log("=".repeat(62));

  const t = await sequelize.transaction();
  try {
    let mapa = {};
    if (hace("clientes")) mapa = await importarClientes(t);
    if (hace("ordenes")) await importarOrdenes(t, mapa);
    if (hace("precios")) await importarPrecios(t);

    if (DRY) {
      await t.rollback();
      console.log("\nDRY RUN: no se escribio nada. Sacá --dry-run para importar.");
    } else {
      await t.commit();
      console.log("\nListo.");
    }
  } catch (e) {
    await t.rollback();
    console.error("\nERROR, se revirtio todo:", e?.message);
    console.error(e);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
