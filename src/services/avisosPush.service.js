"use strict";

// AVISOS PUSH A LA APK (Firebase Cloud Messaging, API HTTP v1).
//
// La APK del backoffice registra el token de su telefono en POST /me/devices.
// Cuando pasa algo que el dueño quiere saber en el momento (una venta, un
// pedido web, una derivacion, un cierre de caja con diferencia, un conteo de
// stock enviado para aprobar) se le manda
// un aviso a cada telefono registrado. Tocar el aviso abre el listado.
//
// Quien recibe:
//   - dueños (super_admin, superadmin, root, owner): todo, de todas las sucursales.
//   - admin de sucursal: solo lo de la sucursal con la que registro el telefono.
//   - el resto de los usuarios: nada (el cajero no necesita enterarse de su
//     propia venta por push).
//
// Configuracion (.env de la API, nunca en git):
//   FCM_CUENTA_SERVICIO = ruta al JSON de la cuenta de servicio de Firebase
//                         (Configuracion del proyecto > Cuentas de servicio).
// Sin esa variable el modulo no hace nada: registra telefonos pero no envia.
// Es a proposito: la venta nunca puede fallar por un aviso. Todo aca es
// "dispara y olvida" y no tira errores hacia afuera.
//
// No usa firebase-admin: alcanza con google-auth-library, que la API ya tiene,
// para sacar el token de OAuth y hacer el POST a FCM.

const fs = require("fs");
const { QueryTypes } = require("sequelize");

const ROLES_DUENO = ["super_admin", "superadmin", "root", "owner"];
const ROLES_ADMIN = ["admin"];

let _sequelize = null;
function db() {
  if (!_sequelize) _sequelize = require("../models").sequelize;
  return _sequelize;
}

// ── Tabla ────────────────────────────────────────────────────────────────────
// Se crea sola la primera vez (como hace telegramNotifier). No va en
// migrations/runner.js para no pisar trabajo en curso sobre ese archivo.

let _tablaLista = null;
function asegurarTabla() {
  if (!_tablaLista) {
    _tablaLista = db()
      .query(
        `CREATE TABLE IF NOT EXISTS user_devices (
           id INT UNSIGNED NOT NULL AUTO_INCREMENT,
           user_id INT UNSIGNED NOT NULL,
           token VARCHAR(255) NOT NULL,
           platform VARCHAR(16) NOT NULL DEFAULT 'android',
           branch_id INT UNSIGNED NULL,
           app_version VARCHAR(32) NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           UNIQUE KEY uq_user_devices_token (token),
           KEY ix_user_devices_user (user_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Telefonos con la APK que reciben avisos push'`,
        { type: QueryTypes.RAW }
      )
      .catch((e) => {
        _tablaLista = null;
        throw e;
      });
  }
  return _tablaLista;
}

// ── Registro de telefonos ────────────────────────────────────────────────────

const TOKEN_VALIDO = /^[A-Za-z0-9_:\-.]{20,255}$/;

/** Alta o actualizacion. Un token es de un solo usuario: si cambia de mano, se reasigna. */
async function registrarDispositivo({ user_id, token, platform, branch_id, app_version }) {
  if (!user_id || !TOKEN_VALIDO.test(String(token || ""))) {
    const e = new Error("Token de dispositivo invalido");
    e.status = 400;
    throw e;
  }
  await asegurarTabla();
  await db().query(
    `INSERT INTO user_devices (user_id, token, platform, branch_id, app_version)
     VALUES (:user_id, :token, :platform, :branch_id, :app_version)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform),
       branch_id = VALUES(branch_id), app_version = VALUES(app_version), last_seen_at = NOW()`,
    {
      replacements: {
        user_id,
        token: String(token),
        platform: String(platform || "android").slice(0, 16),
        branch_id: Number(branch_id) > 0 ? Number(branch_id) : null,
        app_version: app_version ? String(app_version).slice(0, 32) : null,
      },
      type: QueryTypes.INSERT,
    }
  );
  const [fila] = await db().query(`SELECT id FROM user_devices WHERE token = :token LIMIT 1`, {
    replacements: { token: String(token) },
    type: QueryTypes.SELECT,
  });
  return { id: fila?.id || null };
}

/** Baja por id o por token, solo del propio usuario. */
async function quitarDispositivo({ user_id, id_o_token }) {
  await asegurarTabla();
  const v = String(id_o_token || "");
  const porId = /^\d+$/.test(v);
  const [, meta] = await db().query(
    `DELETE FROM user_devices WHERE user_id = :user_id AND ${porId ? "id = :v" : "token = :v"}`,
    { replacements: { user_id, v: porId ? Number(v) : v } }
  );
  return { borrados: Number(meta?.affectedRows ?? meta ?? 0) || 0 };
}

// ── Envio por FCM ────────────────────────────────────────────────────────────

let _cuenta = null;
let _cuentaRuta = null;
function cuentaDeServicio() {
  const ruta = process.env.FCM_CUENTA_SERVICIO;
  if (!ruta) return null;
  if (ruta === _cuentaRuta) return _cuenta;
  _cuentaRuta = ruta;
  _cuenta = null;
  _auth = null;
  try {
    _cuenta = JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch (e) {
    console.warn("[avisosPush] no se pudo leer FCM_CUENTA_SERVICIO:", e.message);
  }
  return _cuenta;
}

let _auth = null;
async function tokenDeAcceso() {
  const cuenta = cuentaDeServicio();
  if (!cuenta) return null;
  if (!_auth) {
    const { GoogleAuth } = require("google-auth-library");
    _auth = new GoogleAuth({
      credentials: cuenta,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
  }
  const client = await _auth.getClient();
  const { token } = await client.getAccessToken();
  return token || null;
}

async function destinatarios(branch_id) {
  await asegurarTabla();
  return db().query(
    `SELECT DISTINCT d.token
       FROM user_devices d
       JOIN user_roles ur ON ur.user_id = d.user_id
       JOIN roles r ON r.id = ur.role_id
      WHERE LOWER(r.name) IN (:duenos)
         OR (LOWER(r.name) IN (:admins) AND :branch_id IS NOT NULL AND d.branch_id = :branch_id)`,
    {
      replacements: { duenos: ROLES_DUENO, admins: ROLES_ADMIN, branch_id: branch_id || null },
      type: QueryTypes.SELECT,
    }
  );
}

/**
 * Manda un aviso. `ruta` es la pantalla del backoffice que abre al tocarlo.
 * Nunca tira: devuelve cuantos salieron.
 */
async function enviar({ titulo, cuerpo, ruta, branch_id = null, tipo = "general" }) {
  try {
    const cuenta = cuentaDeServicio();
    if (!cuenta) return { enviados: 0, motivo: "sin_configurar" };
    const filas = await destinatarios(branch_id);
    if (!filas.length) return { enviados: 0 };

    const acceso = await tokenDeAcceso();
    const url = `https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`;
    let enviados = 0;

    for (const { token } of filas) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${acceso}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: titulo, body: cuerpo || "" },
              data: { ruta: String(ruta || "/app"), tipo: String(tipo) },
              android: { priority: "high", notification: { channel_id: "avisos", tag: tipo } },
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          enviados++;
          continue;
        }
        // Telefono que desinstalo la app o renovo el token: se borra.
        if (r.status === 404 || r.status === 400) {
          const txt = await r.text().catch(() => "");
          if (/UNREGISTERED|INVALID_ARGUMENT/.test(txt)) {
            await db().query(`DELETE FROM user_devices WHERE token = :token`, { replacements: { token } }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn("[avisosPush] fallo un envio:", e.message);
      }
    }
    return { enviados };
  } catch (e) {
    console.warn("[avisosPush] enviar:", e.message);
    return { enviados: 0, motivo: "error" };
  }
}

// ── Textos (docs/diseno-movil/informe.md §5, "Notificaciones (APK)") ────────

function plata(n) {
  const v = Number(n || 0);
  const s = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Math.abs(v));
  return `${v < 0 ? "− " : ""}$ ${s}`;
}

const MEDIOS = { CASH: "Efectivo", CARD: "Tarjeta", DEBIT: "Débito", CREDIT: "Crédito", TRANSFER: "Transferencia", QR: "QR", MP: "Mercado Pago" };

/** Venta registrada en el POS. */
function avisarVenta({ sale_id, sale_number, total, branch_id, metodo }) {
  const medio = metodo ? MEDIOS[String(metodo).toUpperCase()] || String(metodo) : "";
  return enviar({
    tipo: "venta",
    titulo: `Venta #${sale_number || sale_id} · ${plata(total)}${medio ? ` · ${medio}` : ""}`,
    ruta: `/app/pos/sales`,
    branch_id,
  });
}

/** Pedido web nuevo o pagado. */
function avisarPedidoWeb({ codigo, total, entrega, branch_id }) {
  return enviar({
    tipo: "pedido",
    titulo: `Pedido web #${codigo} · ${plata(total)}${entrega ? ` · ${entrega}` : ""}`,
    ruta: `/app/admin/shop/orders`,
    branch_id,
  });
}

/** Derivacion despachada o recibida. */
function avisarDerivacion({ id, estado, origen, destino, branch_id }) {
  const titulo = estado === "recibida"
    ? `Derivación #${id} recibida`
    : `Derivación #${id} despachada${origen && destino ? ` · ${origen} a ${destino}` : ""}`;
  return enviar({ tipo: "derivacion", titulo, ruta: `/app/transfers/${id}`, branch_id });
}

/** Cierre de caja con diferencia distinta de cero. */
function avisarCierreConDiferencia({ cash_register_id, diferencia, branch_id }) {
  if (!Number(diferencia)) return Promise.resolve({ enviados: 0 });
  return enviar({
    tipo: "caja",
    titulo: `Cierre de caja #${cash_register_id} · Diferencia ${plata(diferencia)}`,
    ruta: `/app/admin/cash-registers/${cash_register_id}`,
    branch_id,
  });
}

/** Conteo de stock enviado para aprobar (POST /stock/counts/:id/submit). */
function avisarConteoEnviado({ id, number, branch_id, sucursal, productos, con_diferencia }) {
  const n = Number(productos) || 0;
  const d = Number(con_diferencia) || 0;
  const partes = [
    n === 1 ? "1 producto" : `${n} productos`,
    d ? (d === 1 ? "1 con diferencia" : `${d} con diferencia`) : "sin diferencias",
  ];
  return enviar({
    tipo: "conteo",
    titulo: `Conteo ${number || `#${id}`} para aprobar${sucursal ? ` · ${sucursal}` : ""}`,
    cuerpo: partes.join(" · "),
    ruta: `/app/conteo?id=${id}`,
    branch_id,
  });
}

module.exports = {
  registrarDispositivo,
  quitarDispositivo,
  enviar,
  avisarVenta,
  avisarPedidoWeb,
  avisarDerivacion,
  avisarCierreConDiferencia,
  avisarConteoEnviado,
};
