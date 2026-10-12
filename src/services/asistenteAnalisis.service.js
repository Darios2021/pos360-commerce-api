// src/services/asistenteAnalisis.service.js
// =====================================================================
// ASISTENTE INTERNO · análisis para el dueño (sólo administración, ver MATRIZ).
//
//   ventas-por  ventas agrupadas por vendedor, sucursal, categoría, hora, día de la
//               semana, medio de pago o canal, contra el período anterior de igual largo
//   rotacion    productos con stock y sin ventas en N días, o en baja contra el período anterior
//   clientes    los que más compran (sólo el nombre: nada de documento, teléfono, mail ni dirección)
//
// Lo que POS 360 no registra se declara en `no_registra`, no se inventa.
// Sólo lectura. Mismas fechas que asistente.service.js (UTC guardado, días de Argentina).
// =====================================================================
const { sequelize } = require("../models");
const base = require("./asistente.service");

const { ErrorAsistente, rango, filtroSucursal, reemplazos, n, nombreUsuario, inicioDia } = base;

const AGRUPAR = ["vendedor", "sucursal", "categoria", "hora", "dia_semana", "medio", "canal"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MEDIO = { CASH: "efectivo", TRANSFER: "transferencia", CARD: "tarjeta", QR: "QR", MERCADOPAGO: "Mercado Pago", CREDIT_SJT: "Crédito SJT", OTHER: "otros" };
const HORA_AR = "CONVERT_TZ(s.sold_at,'+00:00','-03:00')";

/** El período anterior de la misma cantidad de días, terminando el día antes de `desde`. */
function anteriorDe(r) {
  const dias = Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000) + 1;
  const hasta = new Date(Date.parse(r.desde) - 86400000).toISOString().slice(0, 10);
  const desde = new Date(Date.parse(r.desde) - dias * 86400000).toISOString().slice(0, 10);
  return { desde, hasta, de: inicioDia(desde), a: inicioDia(r.desde), dias };
}
const variacion = (actual, antes) => (antes > 0 ? Math.round(((actual - antes) / antes) * 1000) / 10 : null);
const rangoAnalisis = (q, defecto) => (q.desde || q.hasta ? rango(q) : rango({}, { defecto }));

/** Filas { clave, cantidad, total, ...extra } de un período. */
async function agrupado(agrupar, u, de, a) {
  const rep = reemplazos(u, { de, a });
  const sf = filtroSucursal(u, "s.branch_id");
  const pagadas = `s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf}`;
  const q = (sql) => sequelize.query(sql, { replacements: rep }).then(([f]) => f);
  switch (agrupar) {
    case "vendedor": {
      const filas = await q(`SELECT ${nombreUsuario} AS clave, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total,
                                    COALESCE(SUM(s.discount_total),0) AS descuentos, SUM(s.discount_total > 0) AS con_descuento
                               FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE ${pagadas} GROUP BY s.user_id, clave`);
      const anul = await q(`SELECT ${nombreUsuario} AS clave, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total
                              FROM sales s LEFT JOIN users u ON u.id = s.user_id
                             WHERE s.status = 'CANCELLED' AND s.sold_at >= :de AND s.sold_at < :a ${sf} GROUP BY s.user_id, clave`);
      const porNombre = new Map(anul.map((x) => [x.clave, x]));
      for (const f of filas) {
        const x = porNombre.get(f.clave);
        f.anuladas = { cantidad: Number(x?.cantidad) || 0, total: n(x?.total) };
        f.descuentos = { total: n(f.descuentos), ventas_con_descuento: Number(f.con_descuento) || 0 };
        delete f.con_descuento;
        porNombre.delete(f.clave);
      }
      // Vendedores que sólo tuvieron anuladas en el período.
      for (const x of porNombre.values()) filas.push({ clave: x.clave, cantidad: 0, total: 0, anuladas: { cantidad: Number(x.cantidad), total: n(x.total) }, descuentos: { total: 0, ventas_con_descuento: 0 } });
      return filas;
    }
    case "sucursal":
      return q(`SELECT COALESCE(b.name, 'sin sucursal') AS clave, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total
                  FROM sales s LEFT JOIN branches b ON b.id = s.branch_id WHERE ${pagadas} GROUP BY clave`);
    case "categoria":
      return q(`SELECT COALESCE(c.name, 'sin categoría') AS clave, COUNT(DISTINCT s.id) AS cantidad, COALESCE(SUM(si.line_total),0) AS total,
                       COALESCE(SUM(si.quantity),0) AS unidades
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id
                  LEFT JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
                 WHERE ${pagadas} GROUP BY clave`);
    case "hora":
      return (await q(`SELECT HOUR(${HORA_AR}) AS h, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s WHERE ${pagadas} GROUP BY h ORDER BY h`))
        .map((f) => ({ ...f, clave: `${String(f.h).padStart(2, "0")} a ${String((Number(f.h) + 1) % 24).padStart(2, "0")} h`, orden: Number(f.h) }));
    case "dia_semana":
      return (await q(`SELECT DAYOFWEEK(${HORA_AR}) AS d, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s WHERE ${pagadas} GROUP BY d`))
        .map((f) => ({ ...f, clave: DIAS[Number(f.d) - 1], orden: (Number(f.d) + 5) % 7 })); // lunes primero
    case "medio":
      // Una venta puede tener varios pagos: acá cuenta pagos, no ventas.
      return (await q(`SELECT p.method AS m, COUNT(*) AS cantidad, COALESCE(SUM(p.amount),0) AS total
                         FROM payments p JOIN sales s ON s.id = p.sale_id WHERE ${pagadas} GROUP BY p.method`))
        .map((f) => ({ clave: MEDIO[f.m] || f.m, cantidad: f.cantidad, total: f.total }));
    case "canal": {
      const [mostrador] = await q(`SELECT 'mostrador (punto de venta)' AS clave, COUNT(*) AS cantidad, COALESCE(SUM(s.total),0) AS total FROM sales s WHERE ${pagadas}`);
      const web = await q(`SELECT CASE WHEN o.fulfillment_type = 'delivery' THEN 'tienda web, con envío' ELSE 'tienda web, retiro en sucursal' END AS clave,
                                  COUNT(*) AS cantidad, COALESCE(SUM(o.total),0) AS total
                             FROM ecom_orders o
                            WHERE o.payment_status = 'paid' AND o.cancelled_at IS NULL
                              AND COALESCE(o.paid_at, o.created_at) >= :de AND COALESCE(o.paid_at, o.created_at) < :a ${filtroSucursal(u, "o.branch_id")}
                            GROUP BY clave`);
      return [mostrador, ...web].filter((f) => Number(f.cantidad) > 0);
    }
    default:
      throw new ErrorAsistente(400, `agrupar: ${AGRUPAR.join(", ")}`);
  }
}

const NO_REGISTRA_VENTAS = {
  vendedor: "quién anuló cada venta: las anuladas se atribuyen a quien la vendió, no a quien la anuló",
  canal: "pedidos por aplicación o por teléfono como canal propio: POS 360 distingue el punto de venta y la tienda web",
};
const NOTAS = {
  medio: "Cuenta pagos, no ventas: una venta pagada con dos medios aparece en los dos.",
  categoria: "Cantidad = ventas que incluyeron esa categoría; total = lo facturado en esa categoría.",
  canal: "Los pedidos de la tienda web se cuentan pagados y no cancelados, por fecha de pago.",
};

async function ventasPor(u, q) {
  const agrupar = AGRUPAR.includes(q.agrupar) ? q.agrupar : null;
  if (!agrupar) throw new ErrorAsistente(400, `agrupar: ${AGRUPAR.join(", ")}`);
  const r = rangoAnalisis(q, 29);
  const ant = anteriorDe(r);
  const [act, prev] = await Promise.all([agrupado(agrupar, u, r.de, r.a), agrupado(agrupar, u, ant.de, ant.a)]);
  const antes = new Map(prev.map((f) => [f.clave, f]));
  const grupos = act.map((f) => {
    const total = n(f.total), cantidad = Number(f.cantidad) || 0, p = antes.get(f.clave);
    const totalAntes = n(p?.total);
    return {
      [agrupar]: f.clave, cantidad, total, ...(agrupar !== "medio" ? { ticket_promedio: cantidad ? Math.round(total / cantidad) : 0 } : {}),
      ...(f.unidades !== undefined ? { unidades: n(f.unidades) } : {}),
      ...(f.anuladas ? { anuladas: f.anuladas, descuentos: f.descuentos } : {}),
      anterior: { cantidad: Number(p?.cantidad) || 0, total: totalAntes }, variacion_pct: variacion(total, totalAntes),
      _orden: f.orden,
    };
  });
  if (agrupar === "hora" || agrupar === "dia_semana") grupos.sort((a, b) => a._orden - b._orden);
  else grupos.sort((a, b) => b.total - a.total);
  for (const g of grupos) delete g._orden;
  const suma = (l, k) => l.reduce((s, f) => s + (Number(f[k]) || 0), 0);
  const total = n(suma(act, "total")), totalAntes = n(suma(prev, "total"));
  return {
    agrupar, desde: r.desde, hasta: r.hasta, periodo_anterior: { desde: ant.desde, hasta: ant.hasta },
    total: { total, anterior: totalAntes, variacion_pct: variacion(total, totalAntes) },
    grupos: grupos.slice(0, 40),
    nota: NOTAS[agrupar], no_registra: NO_REGISTRA_VENTAS[agrupar], moneda: "ARS",
  };
}

async function rotacion(u, q) {
  const modo = q.modo === "en_baja" ? "en_baja" : "sin_rotacion";
  const dias = Math.min(365, Math.max(7, parseInt(q.dias, 10) || (modo === "en_baja" ? 30 : 60)));
  if (modo === "sin_rotacion") {
    const desde = new Date(Date.parse(base.hoy()) - (dias - 1) * 86400000).toISOString().slice(0, 10);
    const [filas] = await sequelize.query(
      `SELECT p.name AS producto, p.sku, COALESCE(c.name, 'sin categoría') AS categoria, SUM(sb.qty) AS existencia,
              SUM(sb.qty) * MAX(${base.COSTO_ACTUAL}) AS valor_costo,
              (SELECT MAX(s2.sold_at) FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id
                WHERE si2.product_id = p.id AND s2.status = 'PAID') AS ultima_venta
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id
         JOIN warehouses w ON w.id = sb.warehouse_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1 AND COALESCE(p.track_stock, 1) = 1 ${filtroSucursal(u, "w.branch_id")}
          AND NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                           WHERE si.product_id = p.id AND s.status = 'PAID' AND s.sold_at >= :de ${filtroSucursal(u, "s.branch_id")})
        GROUP BY p.id, c.name HAVING SUM(sb.qty) > 0
        ORDER BY valor_costo DESC, existencia DESC`,
      { replacements: reemplazos(u, { de: inicioDia(desde) }) }
    );
    return {
      modo, dias, desde, cantidad: filas.length,
      valor_al_costo: n(filas.reduce((s, f) => s + (Number(f.valor_costo) || 0), 0)),
      productos: filas.slice(0, 30).map((f) => ({
        producto: f.producto, sku: f.sku, categoria: f.categoria, existencia: n(f.existencia), valor_costo: n(f.valor_costo),
        ultima_venta: f.ultima_venta ? new Date(`${String(f.ultima_venta instanceof Date ? f.ultima_venta.toISOString() : f.ultima_venta).replace(" ", "T").slice(0, 19)}Z`).toISOString() : null,
      })),
      nota: "Con stock y sin ventas pagadas en el período, ordenados por lo inmovilizado al costo actual (0 si no tiene costo).",
      moneda: "ARS",
    };
  }
  const r = rango({ desde: new Date(Date.parse(base.hoy()) - (dias - 1) * 86400000).toISOString().slice(0, 10), hasta: base.hoy() });
  const ant = anteriorDe(r);
  const unidades = async (de, a) => {
    const [f] = await sequelize.query(
      `SELECT si.product_id AS id, MAX(si.product_name_snapshot) AS producto, SUM(si.quantity) AS unidades, SUM(si.line_total) AS facturado
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${filtroSucursal(u, "s.branch_id")}
        GROUP BY si.product_id`,
      { replacements: reemplazos(u, { de, a }) }
    );
    return new Map(f.map((x) => [Number(x.id), x]));
  };
  const [ahora, antes] = await Promise.all([unidades(r.de, r.a), unidades(ant.de, ant.a)]);
  const MINIMO = 2; // con menos unidades antes, cualquier cosa "cae 100 %"
  const lista = [...antes.entries()].filter(([, p]) => Number(p.unidades) >= MINIMO).map(([id, p]) => {
    const x = ahora.get(id);
    const uAntes = n(p.unidades), uAhora = n(x?.unidades);
    return { producto: p.producto, unidades: uAhora, unidades_antes: uAntes, facturado: n(x?.facturado), facturado_antes: n(p.facturado), variacion_pct: variacion(uAhora, uAntes) };
  }).filter((p) => p.unidades < p.unidades_antes).sort((a, b) => a.variacion_pct - b.variacion_pct || b.unidades_antes - a.unidades_antes);
  return {
    modo, dias, desde: r.desde, hasta: r.hasta, periodo_anterior: { desde: ant.desde, hasta: ant.hasta },
    cantidad: lista.length, productos: lista.slice(0, 20),
    nota: `En unidades, sólo productos con ${MINIMO} o más unidades vendidas en el período anterior.`,
    moneda: "ARS",
  };
}

async function clientes(u, q) {
  const r = rangoAnalisis(q, 89);
  const limite = Math.min(30, Math.max(1, parseInt(q.limite, 10) || 10));
  const rep = reemplazos(u, { de: r.de, a: r.a });
  const sf = filtroSucursal(u, "s.branch_id");
  // Sólo el nombre: ni documento, ni teléfono, ni mail, ni dirección salen de acá.
  const [filas] = await sequelize.query(
    `SELECT COALESCE(NULLIF(TRIM(c.display_name),''), NULLIF(TRIM(CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,''))),''), TRIM(s.customer_name)) AS cliente,
            COUNT(*) AS compras, COALESCE(SUM(s.total),0) AS total, MAX(s.sold_at) AS ultima
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf}
        AND (s.customer_id IS NOT NULL OR (NULLIF(TRIM(s.customer_name),'') IS NOT NULL AND UPPER(TRIM(s.customer_name)) NOT IN ('CONSUMIDOR FINAL','CONSUMIDOR','CLIENTE','-')))
      GROUP BY COALESCE(CONCAT('id:', s.customer_id), CONCAT('n:', UPPER(TRIM(s.customer_name)))), cliente
      ORDER BY total DESC LIMIT ${limite}`,
    { replacements: rep }
  );
  const [[tot]] = await sequelize.query(
    `SELECT COUNT(*) AS ventas, SUM(s.customer_id IS NULL AND (NULLIF(TRIM(s.customer_name),'') IS NULL OR UPPER(TRIM(s.customer_name)) IN ('CONSUMIDOR FINAL','CONSUMIDOR','CLIENTE','-'))) AS sin_cliente
       FROM sales s WHERE s.status = 'PAID' AND s.sold_at >= :de AND s.sold_at < :a ${sf}`,
    { replacements: rep }
  );
  return {
    desde: r.desde, hasta: r.hasta,
    clientes: filas.map((f) => ({ cliente: f.cliente, compras: Number(f.compras), total: n(f.total), ticket_promedio: Number(f.compras) ? Math.round(n(f.total) / Number(f.compras)) : 0 })),
    ventas: Number(tot.ventas) || 0, ventas_sin_cliente: Number(tot.sin_cliente) || 0,
    nota: "Sólo ventas con cliente identificado (consumidor final no cuenta). Se informa el nombre, ningún otro dato personal.",
    moneda: "ARS",
  };
}

module.exports = { AGRUPAR, ventasPor, rotacion, clientes, anteriorDe };
