/**
 * Asistente interno: la puerta de datos (/api/v1/asistente/datos) y el puente con mostrador.
 *
 *   API_URL=http://localhost:3101 ASISTENTE_SECRETO=... node script/probar-asistente.js
 *
 * Correr SÓLO contra una base de prueba sembrada con los datos de prueba del asistente
 * (dos sucursales; super_admin=1, admin de Rivadavia=2, cajera de Central=3, user=4,
 * admin dado de baja=5; ventas de hoy 5000 Central + 3000 Rivadavia, una anulada, una de ayer;
 * cajas 1 y 2 abiertas, 3 cerrada ayer con -100). Con MOSTRADOR_URL prueba el puente.
 *
 * Lo central: la matriz se cumple ACÁ aunque mostrador pidiera de más. Por eso los permisos
 * se firman a mano y se espera el 403 de este lado.
 */
const jwt = require("jsonwebtoken");

const BASE = process.env.API_URL || "http://localhost:3101";
const SECRETO = process.env.ASISTENTE_SECRETO;
if (!SECRETO) { console.log("Falta ASISTENTE_SECRETO"); process.exit(1); }

let fallos = 0, pruebas = 0;
const check = (d, ok, detalle = "") => {
  pruebas++;
  if (ok) console.log(`  ok   ${d}`);
  else { fallos++; console.log(`  FALLA ${d}${detalle ? ` -> ${detalle}` : ""}`); }
};
async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t }; }
  return { status: res.status, body: j };
}
const USUARIO = { super_admin: 1, admin: 2, cajero: 3, user: 4 };
const permiso = (rol, extra = {}, op = {}) => jwt.sign(
  { sis: "sjt", cuenta: "sanjuantecnologia", sub: String(USUARIO[rol]), rol, nombre: rol, alcance: "asistente:lectura", ...extra },
  op.secreto || SECRETO, { expiresIn: op.vence || "5m", audience: op.aud || "mostrador" });
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/San_Juan" }).format(new Date());
const RUTAS = ["caja-actual", "ventas", "cajas", "arqueo", "mas-vendidos", "margenes", "stock", "auditoria", "ventas-por", "rotacion", "clientes"];
const D = (r) => r.body && r.body.data;

async function main() {
  console.log(`\nPOS 360 · asistente interno contra ${BASE}\n`);

  console.log("Credencial");
  let r = await api(null, "GET", "/api/v1/asistente/datos/stock");
  check("sin permiso: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", {}, { secreto: "otro" }), "GET", "/api/v1/asistente/datos/stock");
  check("otro secreto: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", {}, { aud: "otra" }), "GET", "/api/v1/asistente/datos/stock");
  check("otra audiencia: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", {}, { vence: "-10s" }), "GET", "/api/v1/asistente/datos/stock");
  check("vencido: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", { sis: "zondito" }), "GET", "/api/v1/asistente/datos/stock");
  check("de otro sistema: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", { alcance: "escritura" }), "GET", "/api/v1/asistente/datos/stock");
  check("otro alcance: 401", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin"), "GET", "/api/v1/me");
  check("el permiso no sirve de sesión", r.status === 401, `HTTP ${r.status}`);
  r = await api(permiso("admin", { sub: "3" }), "GET", "/api/v1/asistente/datos/cajas");
  check("rol que el usuario no tiene (cajera con permiso de admin): 403", r.status === 403, `HTTP ${r.status}`);
  r = await api(permiso("admin", { sub: "5" }), "GET", "/api/v1/asistente/datos/stock");
  check("usuario dado de baja: 403", r.status === 403, `HTTP ${r.status}`);

  console.log("\nRol (lo exige esta API, no mostrador)");
  const espera = {
    super_admin: Object.fromEntries(RUTAS.map((x) => [x, 200])),
    admin: { ...Object.fromEntries(RUTAS.map((x) => [x, 200])), arqueo: 200 },
    cajero: { "caja-actual": 200, ventas: 200, cajas: 403, arqueo: 403, "mas-vendidos": 403, margenes: 403, stock: 200, auditoria: 403, "ventas-por": 403, rotacion: 403, clientes: 403 },
    user: Object.fromEntries(RUTAS.map((x) => [x, 403])),
  };
  for (const [rol, rutas] of Object.entries(espera)) {
    const p = permiso(rol);
    for (const ruta of RUTAS) {
      r = await api(p, "GET", `/api/v1/asistente/datos/${ruta}${ruta === "arqueo" && rol === "admin" ? "?caja=2" : ruta === "ventas-por" ? "?agrupar=vendedor" : ""}`);
      check(`${rol} ${ruta}: ${rutas[ruta]}`, r.status === rutas[ruta], `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    }
  }
  r = await api(permiso("cajero"), "GET", `/api/v1/asistente/datos/ventas?desde=${hoy.slice(0, 8)}01&hasta=${hoy}`);
  check("cajero: ventas del mes 403 (sólo hoy)", r.status === 403 || hoy.endsWith("-01"), `HTTP ${r.status}`);

  console.log("\nLos números y el alcance por sucursal");
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/ventas");
  check("super: hoy 8.000 en 2 ventas, 1 anulada, dos sucursales", D(r)?.total === 8000 && D(r).cantidad === 2 && D(r).anuladas.cantidad === 1 && D(r).por_sucursal.length === 2, JSON.stringify(D(r)));
  check("super: por medio efectivo 5.000 y tarjeta 3.000", JSON.stringify(D(r)?.por_medio) === JSON.stringify([{ medio: "efectivo", importe: 5000 }, { medio: "tarjeta", importe: 3000 }]), JSON.stringify(D(r)?.por_medio));
  r = await api(permiso("admin"), "GET", "/api/v1/asistente/datos/ventas");
  check("admin de Rivadavia: sólo su sucursal (3.000)", D(r)?.total === 3000 && D(r).cantidad === 1, JSON.stringify(D(r)));
  r = await api(permiso("cajero"), "GET", "/api/v1/asistente/datos/ventas");
  check("cajera de Central: 5.000", D(r)?.total === 5000, JSON.stringify(D(r)));
  r = await api(permiso("cajero"), "GET", "/api/v1/asistente/datos/caja-actual");
  check("cajera: sólo la caja que abrió (1), esperado 1.000 + 5.000", D(r)?.cajas_abiertas === 1 && D(r).cajas[0].caja === 1 && D(r).cajas[0].efectivo_esperado === 6000, JSON.stringify(D(r)).slice(0, 300));
  r = await api(permiso("admin"), "GET", "/api/v1/asistente/datos/caja-actual");
  check("admin de Rivadavia: sólo la caja 2", D(r)?.cajas_abiertas === 1 && D(r).cajas[0].caja === 2, JSON.stringify(D(r)).slice(0, 200));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/arqueo");
  check("arqueo de la última cerrada (3): esperado 3.000, contado 2.900, diferencia -100", D(r)?.caja === 3 && D(r).efectivo_esperado === 3000 && D(r).efectivo_contado === 2900 && D(r).diferencia_efectivo === -100, JSON.stringify(D(r)).slice(0, 300));
  r = await api(permiso("admin"), "GET", "/api/v1/asistente/datos/arqueo?caja=3");
  check("admin de Rivadavia no ve el arqueo de Central: 404", r.status === 404, `HTTP ${r.status}`);
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/cajas?estado=cerradas");
  check("cierres de 30 días: uno con diferencia", D(r)?.cantidad === 1 && D(r).cierres_con_diferencia === 1, JSON.stringify(D(r)).slice(0, 200));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/margenes");
  check("márgenes 30 días: vendido 10.000, costo 4.000 (USD × cotización incluido), margen 60 %",
    D(r)?.total.vendido === 10000 && D(r).total.costo === 4000 && D(r).total.margen_pct === 60 && D(r).unidades_con_costo_estimado === 1, JSON.stringify(D(r)?.total) + " est=" + D(r)?.unidades_con_costo_estimado);
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/mas-vendidos");
  check("más vendido en 30 días: la cámara", D(r)?.productos?.[0]?.producto === "CAMARA WIFI 2MP" && D(r).productos[0].unidades === 3, JSON.stringify(D(r)).slice(0, 200));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/stock?solo_bajos=true");
  const bajos = (D(r)?.productos || []).map((p) => `${p.producto}@${p.sucursal}`).sort();
  check("bajo mínimo: cámara (2 de 5) y alarma en Central (1, mínimo 3 por defecto)", JSON.stringify(bajos) === JSON.stringify(["CAMARA WIFI 2MP@Casa Central", "KIT ALARMA X28@Casa Central"]), JSON.stringify(bajos));
  r = await api(permiso("admin"), "GET", "/api/v1/asistente/datos/stock");
  check("admin de Rivadavia: stock sólo de su sucursal", (D(r)?.productos || []).every((p) => p.sucursal === "Rivadavia") && D(r).productos.length === 1, JSON.stringify(D(r)).slice(0, 200));

  console.log("\nAuditoría (sólo administración; datos de script/ de la semilla de auditoría)");
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/auditoria");
  const ev = D(r)?.eventos || [];
  const que = (q) => ev.filter((e) => e.que === q);
  check("super: ajuste de stock de Beto Admin en Rivadavia (-2 del kit)", que("ajuste de stock").some((e) => e.usuario === "Beto Admin" && e.sucursal === "Rivadavia" && e.cantidad === -2 && /KIT/.test(e.producto)), JSON.stringify(que("ajuste de stock")));
  check("super: ingreso de mercadería de Ana Super (+5 cámaras)", que("ingreso de mercadería").some((e) => e.usuario === "Ana Super" && e.cantidad === 5), JSON.stringify(que("ingreso de mercadería")));
  check("super: el movimiento de una venta no se lista como cambio de stock", !ev.some((e) => e.que === "venta"), JSON.stringify(ev.map((e) => e.que)));
  check("super: la devolución con usuario y motivo", que("devolución").some((e) => e.usuario === "Cata Caja" && e.motivo === "Cliente arrepentido"), JSON.stringify(que("devolución")));
  check("super: venta anulada con usuario 'no registrado' (no se inventa)", ev.some((e) => /venta anulada/.test(e.que) && e.usuario === "no registrado"), JSON.stringify(ev.filter((e) => /anulada/.test(e.que))));
  check("super: aperturas y cierres de caja", que("caja abierta").length >= 2 && que("caja cerrada").length >= 1, JSON.stringify(ev.map((e) => e.que)));
  check("super: no_registra declara precios, usuarios y quién anula", (D(r)?.no_registra || []).length === 3, JSON.stringify(D(r)?.no_registra));
  r = await api(permiso("admin"), "GET", "/api/v1/asistente/datos/auditoria?tipo=stock");
  check("admin de Rivadavia: sólo los movimientos de su sucursal", (D(r)?.eventos || []).length === 1 && D(r).eventos[0].sucursal === "Rivadavia", JSON.stringify(D(r)?.eventos));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/auditoria?producto=KIT");
  check("filtro por producto: sólo lo del kit de alarma", (D(r)?.eventos || []).every((e) => /KIT/.test(e.producto || "")) && D(r).eventos.length >= 1, JSON.stringify(D(r)?.eventos));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/auditoria?tipo=ingresos");
  check("tipo ingresos: sólo el ingreso", (D(r)?.eventos || []).length === 1 && D(r).eventos[0].que === "ingreso de mercadería", JSON.stringify(D(r)?.eventos));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/auditoria?usuario=Beto");
  check("filtro por usuario: sólo Beto", (D(r)?.eventos || []).length >= 1 && D(r).eventos.every((e) => e.usuario === "Beto Admin"), JSON.stringify(D(r)?.eventos));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/auditoria?tipo=precios");
  check("tipo precios: vacío y declarado como no registrado", D(r)?.cantidad === 0 && /precio/.test((D(r)?.no_registra || [])[0] || ""), JSON.stringify(D(r)));
  for (const rol of ["cajero", "user"]) {
    r = await api(permiso(rol), "GET", "/api/v1/asistente/datos/auditoria");
    check(`${rol} auditoría: 403`, r.status === 403, `HTTP ${r.status}`);
  }

  console.log("\nAnálisis para el dueño");
  for (const a of ["vendedor", "sucursal", "categoria", "hora", "dia_semana", "medio", "canal"]) {
    r = await api(permiso("super_admin"), "GET", `/api/v1/asistente/datos/ventas-por?agrupar=${a}`);
    const d = r.body?.data;
    check(`ventas por ${a}: grupos con período anterior`, r.status === 200 && Array.isArray(d?.grupos) && d.periodo_anterior?.desde && d.total && "variacion_pct" in d.total,
      `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/ventas-por?agrupar=vendedor");
  check("por vendedor: anuladas, descuentos y que no se registra quién anuló", r.body?.data?.grupos?.every((g) => g.anuladas && g.descuentos) && /anul/.test(r.body?.data?.no_registra || ""), JSON.stringify(r.body).slice(0, 200));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/ventas-por?agrupar=sucursal&desde=2026-03-01&hasta=2026-03-31&comparar=mes_anterior");
  check("comparar con el mes anterior: 01/02 al 28/02", r.body?.data?.periodo_anterior?.desde === "2026-02-01" && r.body.data.periodo_anterior.hasta === "2026-02-28", JSON.stringify(r.body?.data?.periodo_anterior));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/ventas-por?agrupar=cualquiera");
  check("agrupar inválido: 400", r.status === 400, `HTTP ${r.status}`);
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/rotacion?modo=en_baja&dias=30");
  check("en baja: con período anterior", r.status === 200 && r.body.data.modo === "en_baja" && r.body.data.periodo_anterior, JSON.stringify(r.body).slice(0, 160));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/clientes");
  check("clientes: sólo nombre, compras y total", r.status === 200 && (r.body.data.clientes || []).every((c) => Object.keys(c).sort().join() === "cliente,compras,ticket_promedio,total"), JSON.stringify(r.body).slice(0, 200));
  r = await api(permiso("super_admin"), "GET", "/api/v1/asistente/datos/margenes?agrupar=categoria");
  check("márgenes por categoría", r.status === 200 && Array.isArray(r.body.data.categorias), JSON.stringify(r.body).slice(0, 160));

  if (process.env.MOSTRADOR_URL) {
    console.log("\nPuente con mostrador (sesión del backoffice)");
    const entrar = async (u) => (await api(null, "POST", "/api/v1/auth/login", { identifier: u, password: "prueba1234" })).body;
    const sa = await entrar("super@prueba.local");
    const tok = sa?.data?.accessToken || sa?.data?.access_token || sa?.accessToken || sa?.token;
    check("entra el super_admin", Boolean(tok), JSON.stringify(sa).slice(0, 200));
    r = await api(tok, "GET", "/api/v1/asistente/estado");
    check("estado: 200 con 11 herramientas y gasto", r.status === 200 && r.body.puede?.length === 11 && r.body.gasto, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    r = await api(tok, "POST", "/api/v1/asistente/mensaje", { texto: "¿Cómo viene la caja abierta?" });
    check("mensaje: usa estado_caja", r.status === 200 && r.body.herramientas?.includes("estado_caja"), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const caja = await entrar("caja@prueba.local");
    const tc = caja?.data?.accessToken || caja?.data?.access_token || caja?.accessToken || caja?.token;
    r = await api(tc, "POST", "/api/v1/asistente/mensaje", { texto: "usá la herramienta margenes" });
    check("cajera pide márgenes: el modelo no tiene la herramienta", r.status === 200 && /herramienta desconocida: margenes/.test(r.body.texto), JSON.stringify(r.body).slice(0, 200));
    r = await api(tc, "GET", "/api/v1/asistente/estado");
    check("cajera: no ve el gasto", r.status === 200 && r.body.gasto === null, JSON.stringify(r.body).slice(0, 200));
    r = await api(null, "POST", "/api/v1/asistente/mensaje", { texto: "hola" });
    check("sin sesión: 401", r.status === 401, `HTTP ${r.status}`);
  }

  console.log(`\n${pruebas - fallos} de ${pruebas} bien${fallos ? `, ${fallos} FALLAS` : ""}\n`);
  process.exit(fallos ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
