// ✅ COPY-PASTE FINAL
// src/services/fiscalDocument.service.js

const { SaleDocument } = require("../models");

async function maybeCreateFiscalDocument({
  sale,
  snapshot,
  transaction,
}) {
  if (!snapshot) return null;

  if (snapshot.invoice_mode === "NO_FISCAL") {
    return null;
  }

  const doc = await SaleDocument.create(
    {
      sale_id: sale.id,
      branch_id: sale.branch_id,
      customer_name: snapshot.customer_name,
      customer_doc: snapshot.customer_doc,
      customer_tax_condition: snapshot.customer_tax_condition,
      invoice_type: snapshot.invoice_type,
      total: sale.total,
      status: "PENDING",
    },
    { transaction }
  );

  await sale.update(
    {
      fiscal_status: "PENDING",
      fiscal_document_id: doc.id,
    },
    { transaction }
  );

  return doc;
}

module.exports = { maybeCreateFiscalDocument };