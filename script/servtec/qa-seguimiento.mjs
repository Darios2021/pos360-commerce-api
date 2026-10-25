// script/servtec/qa-seguimiento.mjs
//
// Prueba de punta a punta del servicio tecnico: ingreso, derivacion a un
// tecnico, alcance del cajero, cambios de estado, avisos por WhatsApp, notas y
// borrado. Corre contra una API LOCAL, nunca contra produccion: crea y borra
// ordenes y marca tecnicos.
//
// Necesita tres usuarios con la misma clave: un admin, un cajero que recibe y
// otro cajero que es el tecnico.
//
//   QA_API=http://localhost:3311/api/v1 QA_CLAVE=... \
//   QA_ADMIN=admin QA_CAJA=caja QA_TECNICO=tecnico \
//   QA_TECNICO_ID=3 QA_CAJA_ID=2 node script/servtec/qa-seguimiento.mjs

const B = process.env.QA_API || "http://localhost:3311/api/v1";
if (/cingulado|sanjuantecnologia/.test(B)) {
  console.error("QA_API apunta a produccion: esta prueba escribe. Se corta.");
  process.exit(2);
}
const CLAVE = process.env.QA_CLAVE || "prueba123";
const TEC_ID = Number(process.env.QA_TECNICO_ID || 3);
const CAJA_ID = Number(process.env.QA_CAJA_ID || 2);
let fallas = 0;
const ok = (c, m) => { console.log(`${c ? "OK  " : "FALLA"} ${m}`); if (!c) fallas++; };

async function login(u) {
  const r = await fetch(`${B}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: u, username: u, password: CLAVE }) });
  const j = await r.json();
  return j.accessToken || j.token || j.data?.accessToken;
}
function api(tok) {
  return async (method, path, body) => {
    const r = await fetch(`${B}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
}

const admin = api(await login(process.env.QA_ADMIN || "admin"));
const caja = api(await login(process.env.QA_CAJA || "caja"));
const tec = api(await login(process.env.QA_TECNICO || "tecnico"));

// Punto de partida: el tecnico marcado y el cajero no.
await admin("PUT", `/admin/service/technicians/${CAJA_ID}`, { es_tecnico: false });

// 1. Marcar tecnico: solo admin
let r = await caja("PUT", `/admin/service/technicians/${TEC_ID}`, { es_tecnico: true });
ok(r.status === 403, `cajero no puede marcar tecnicos (${r.status})`);
r = await admin("PUT", `/admin/service/technicians/${TEC_ID}`, { es_tecnico: true });
ok(r.status === 200 && r.j.data.find((u) => u.id === TEC_ID)?.es_tecnico, "admin marca a Tomas como tecnico");
r = await caja("GET", "/admin/service/technicians");
ok(r.j?.data?.some((u) => u.id === TEC_ID) && !r.j.data.some((u) => u.id === CAJA_ID), "lista de tecnicos para derivar");
const TEC_NOMBRE = r.j.data.find((u) => u.id === TEC_ID)?.name;

// 2. Ingreso por el cajero
r = await caja("POST", "/admin/service/orders", {
  customer_name: "Juan Perez", customer_phone: "2645123456", device_brand: "Samsung", device_model: "A04",
  reported_fault: "No carga", device_accessories: "Funda", quoted_amount: 30000, deposit: 10000,
  estimated_pickup: "2026-10-30",
});
ok(r.status === 201, `cajero recibe un equipo (${r.status})`);
const o = r.j.data;
ok(/^OT-\d{5}$/.test(o.numero_visible), `numero ${o.numero_visible}`);
ok(o.events?.length === 1 && o.events[0].kind === "ingreso" && !!o.events[0].user_name, "seguimiento: ingreso con quien lo recibio");

// 3. Derivar a alguien que no es tecnico
r = await caja("PUT", `/admin/service/orders/${o.id}`, { technician_id: CAJA_ID });
ok(r.status === 400 && r.j.code === "NO_ES_TECNICO", "no deriva a un usuario que no es tecnico");

// 4. Derivar al tecnico con nota
r = await caja("PUT", `/admin/service/orders/${o.id}`, { technician_id: TEC_ID, nota: "Revisar pin de carga" });
ok(r.status === 200 && r.j.data.technician_name === TEC_NOMBRE, "deriva al tecnico, nombre congelado del usuario");
const evT = r.j.data.events.find((e) => e.kind === "tecnico");
ok(evT && evT.note === "Revisar pin de carga", "seguimiento: derivacion con nota");
r = await caja("PUT", `/admin/service/orders/${o.id}`, { technician_id: TEC_ID, technician_name: "Otro" });
ok(r.j.data.events.filter((e) => e.kind === "tecnico").length === 1 && r.j.data.technician_name === TEC_NOMBRE, "re-guardar sin cambio no duplica ni pisa el nombre");

// 5. Cola del tecnico: ve lo derivado aunque no lo recibio
r = await tec("GET", "/admin/service/orders?mios=1&limit=100");
ok(r.j?.data?.some((x) => x.id === o.id) && r.j.data.every((x) => x.technician_id === TEC_ID), "el tecnico ve la orden en su cola, y solo lo suyo");
r = await tec("GET", "/admin/service/orders?limit=100");
ok(r.j?.data?.some((x) => x.id === o.id), "el tecnico (cajero) ve lo derivado en el listado general");
r = await tec("GET", "/admin/service/orders/stats?mios=1");
ok(r.j?.data?.en_taller >= 1, "stats de la cola del tecnico");

// 6. Cambios de estado
r = await tec("PUT", `/admin/service/orders/${o.id}`, { status: "presupuestado", technical_report: "Pin de carga sulfatado" });
ok(r.j.cambio_estado === true, "tecnico pasa a presupuestado (cambio_estado=true)");
r = await tec("PUT", `/admin/service/orders/${o.id}`, { technical_report: "Pin de carga sulfatado, se cambia" });
ok(r.j.cambio_estado === false, "guardar sin cambiar estado no genera evento");
r = await tec("PUT", `/admin/service/orders/${o.id}`, { status: "reparado", nota: "Probado OK" });
const evs = r.j.data.events.filter((e) => e.kind === "estado");
ok(evs.length === 2 && evs[1].from_status === "presupuestado" && evs[1].to_status === "reparado" && evs[1].note === "Probado OK" && evs[1].user_name === TEC_NOMBRE, "seguimiento: estados con desde/hacia, nota y quien");

// 7. WhatsApp
r = await caja("POST", `/admin/service/orders/${o.id}/whatsapp`, { tipo: "comprobante" });
ok(r.status === 200 && r.j.data.link?.startsWith("https://wa.me/542645123456?text="), "comprobante: link wa.me");
ok(r.j.data.texto.includes(o.numero_visible) && r.j.data.texto.includes("Saldo: $ 20.000"), "comprobante: numero y saldo");
console.log("\n--- comprobante ---\n" + r.j.data.texto);
r = await caja("POST", `/admin/service/orders/${o.id}/whatsapp`, { tipo: "estado" });
ok(r.j.data.texto.includes("listo para retirar") && r.j.data.texto.includes("Saldo a pagar"), "aviso de estado reparado");
console.log("\n--- aviso de estado ---\n" + r.j.data.texto + "\n");
ok(r.j.data.events.filter((e) => e.kind === "aviso").length === 2, "seguimiento: los dos avisos quedan registrados");

// 8. Nota interna
r = await tec("POST", `/admin/service/orders/${o.id}/notes`, { nota: "Cliente llamo, pasa el lunes" });
ok(r.status === 201 && r.j.data.at(-1).kind === "nota", "nota interna");

// 9. Sin telefono
r = await caja("POST", "/admin/service/orders", { customer_name: "Sin tel" });
const o2 = r.j.data;
r = await caja("POST", `/admin/service/orders/${o2.id}/whatsapp`, { tipo: "comprobante" });
ok(r.status === 400 && r.j.code === "SIN_TELEFONO", "sin telefono: avisa, no rompe");

// 10. Alcance: el tecnico no ve la orden 2 (no la recibio ni se la derivaron)
r = await tec("GET", "/admin/service/orders?limit=100");
ok(!r.j.data.some((x) => x.id === o2.id), "el tecnico no ve ordenes ajenas");

// 11. Desmarcar tecnico no borra la derivacion hecha
r = await admin("PUT", `/admin/service/technicians/${TEC_ID}`, { es_tecnico: false });
r = await admin("GET", `/admin/service/orders/${o.id}`);
ok(r.j.data.technician_name === TEC_NOMBRE, "desmarcar no borra la orden derivada");
await admin("PUT", `/admin/service/technicians/${TEC_ID}`, { es_tecnico: true });

// 12. Borrar limpia el seguimiento
r = await admin("DELETE", `/admin/service/orders/${o2.id}`);
ok(r.status === 200, "admin borra la orden 2");
r = await admin("DELETE", `/admin/service/orders/${o.id}`);
ok(r.status === 200, "admin borra la orden de prueba");

console.log(fallas ? `\n${fallas} FALLAS` : "\nTODO OK");
process.exit(fallas ? 1 : 0);
