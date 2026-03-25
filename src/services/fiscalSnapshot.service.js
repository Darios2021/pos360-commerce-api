// ✅ COPY-PASTE FINAL
// src/services/fiscalSnapshot.service.js

function resolveFiscalSnapshot({ body, cashRegister }) {
  const extra = body.extra || {};
  const c = extra.customer || body.customer || {};

  const first = c.first_name || c.nombre || "";
  const last = c.last_name || c.apellido || "";

  const fullName = `${first} ${last}`.trim();

  const customer_name =
    body.customer_name ||
    c.name ||
    c.razon_social ||
    fullName ||
    "Consumidor Final";

  const customer_doc =
    body.customer_doc ||
    c.doc ||
    c.dni ||
    c.cuit ||
    null;

  const customer_email = c.email || null;
  const customer_phone = c.phone || c.telefono || null;
  const customer_address = c.address || c.direccion || null;

  const customer_doc_type = c.doc_type || "DNI";

  const customer_tax_condition =
    c.tax_condition ||
    (customer_doc ? "RESPONSABLE_INSCRIPTO" : "CONSUMIDOR_FINAL");

  // 🔥 FIX CLAVE: tomar primero lo que viene del POS (extra)
  const invoice_mode =
    extra.invoice_mode ||
    body.invoice_mode ||
    cashRegister?.invoice_mode ||
    "NO_FISCAL";

  const invoice_type =
    extra.invoice_type ||
    body.invoice_type ||
    cashRegister?.invoice_type ||
    "B";

  return {
    customer_name,
    customer_doc,
    customer_email,
    customer_phone,
    customer_address,
    customer_doc_type,
    customer_tax_condition,
    invoice_mode,
    invoice_type,
  };
}

module.exports = { resolveFiscalSnapshot };