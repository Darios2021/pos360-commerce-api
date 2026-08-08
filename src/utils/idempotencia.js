"use strict";

// Evita que un mismo cobro se registre dos veces.
//
// El caso real no es el doble clic (eso ya lo frena el boton del checkout, que
// se deshabilita mientras la request esta en vuelo). El caso real es: la venta
// sale, la red se corta o el servidor tarda, el cajero no ve confirmacion y
// vuelve a cobrar. Sin nada que los relacione, quedan dos ventas, el stock baja
// dos veces y la caja cierra con diferencia.
//
// El POS manda una clave por intento de cobro. Si llega dos veces la misma, la
// segunda no crea nada: devuelve la venta que ya existe.

const CLAVE_VALIDA = /^[A-Za-z0-9_-]{8,64}$/;

/** Lee la clave del encabezado o del cuerpo. Sin clave, se sigue como antes. */
function leerClave(req) {
  const cruda =
    req?.get?.("Idempotency-Key") ||
    req?.headers?.["idempotency-key"] ||
    req?.body?.idempotency_key ||
    "";
  const clave = String(cruda).trim();
  if (!clave) return null;
  // Una clave con formato raro se ignora en vez de rechazar el cobro: perder una
  // venta por un encabezado mal armado seria peor que el problema que resuelve.
  return CLAVE_VALIDA.test(clave) ? clave : null;
}

/** Busca una venta ya registrada con esa clave. Devuelve la fila o null. */
async function buscarVentaPrevia(sequelize, clave, { transaction } = {}) {
  if (!clave) return null;
  const [filas] = await sequelize.query(
    `SELECT id, branch_id, cash_register_id, user_id, status,
            customer_name, customer_phone, customer_doc,
            subtotal, total, paid_total, change_total,
            sale_number, fiscal_document_id, fiscal_status, created_at
       FROM sales
      WHERE idempotency_key = :clave
      LIMIT 1`,
    { replacements: { clave }, transaction }
  );
  return filas && filas.length ? filas[0] : null;
}

/**
 * Reconoce el choque contra el indice unico de la clave. Pasa cuando dos
 * intentos entran a la vez y los dos pasaron el SELECT previo.
 */
function esClaveDuplicada(err) {
  const numero = err?.original?.errno ?? err?.parent?.errno;
  const texto = String(err?.original?.sqlMessage || err?.message || "");
  return numero === 1062 && /idempotency/i.test(texto);
}

/** Arma la respuesta de un cobro repetido con la forma que espera el POS. */
function respuestaRepetida(venta) {
  return {
    ok: true,
    repetida: true,
    mensaje: "Esta venta ya estaba registrada. No se cobro de nuevo.",
    data: {
      sale_id: venta.id,
      branch_id: venta.branch_id,
      cash_register_id: venta.cash_register_id || null,
      user_id: venta.user_id,
      status: venta.status,
      sale_number: venta.sale_number,
      fiscal_document_id: venta.fiscal_document_id || null,
      fiscal_status: venta.fiscal_status || "NOT_REQUESTED",
      customer_name: venta.customer_name,
      customer_phone: venta.customer_phone,
      customer_doc: venta.customer_doc,
      subtotal: venta.subtotal,
      total: venta.total,
      paid_total: venta.paid_total,
      change_total: venta.change_total,
      created_at: venta.created_at,
    },
  };
}

module.exports = {
  CLAVE_VALIDA,
  leerClave,
  buscarVentaPrevia,
  esClaveDuplicada,
  respuestaRepetida,
};
