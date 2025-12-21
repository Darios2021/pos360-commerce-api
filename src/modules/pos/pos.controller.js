// src/modules/pos/pos.controller.js
const { sequelize, Sale, SaleItem, Payment } = require("../../models");

async function createSale(req, res) {
  let t;
  try {
    const body = req.body || {};
    const {
      branch_id = 1,
      customer_name,
      items = [],
      payments = [],
    } = body;

    console.log("💰 [POS] Procesando venta...");
    console.log("📥 BODY:", JSON.stringify(body, null, 2));

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Venta sin items" });
    }
    if (!Array.isArray(payments)) {
      return res.status(400).json({ ok: false, message: "payments debe ser un array" });
    }

    t = await sequelize.transaction();

    // 1) Calcular total
    let total = 0;
    for (const i of items) {
      const q = Number(i.quantity ?? 0);
      const p = Number(i.unit_price ?? 0);

      if (!i.product_id) throw new Error("Item inválido: falta product_id");
      if (!Number.isFinite(q) || q <= 0) throw new Error(`Item inválido: quantity=${i.quantity}`);
      if (!Number.isFinite(p) || p <= 0) throw new Error(`Item inválido: unit_price=${i.unit_price}`);

      total += q * p;
    }

    // 2) Crear cabecera
    const sale = await Sale.create(
      {
        branch_id: Number(branch_id) || 1,
        user_id: req.user?.id || 1,
        customer_name: customer_name || "Consumidor Final",

        subtotal: total,
        discount_total: 0,
        tax_total: 0,
        total: total,

        paid_total: 0,
        change_total: 0,

        status: "PAID",
        sold_at: new Date(),
      },
      { transaction: t }
    );

    // 3) Crear items
    for (const i of items) {
      const qty = Number(i.quantity);
      const price = Number(i.unit_price);
      const lineTotal = qty * price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: i.product_id,
          quantity: qty,
          unit_price: price,
          line_total: lineTotal,
          product_name_snapshot: i.product_name_snapshot || "Item",
        },
        { transaction: t }
      );
    }

    // 4) Crear pagos
    let totalPaid = 0;

    for (const p of payments) {
      const amount = Number(p.amount ?? 0);
      const method = String(p.method || "CASH").toUpperCase();

      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Pago inválido: amount=${p.amount}`);
      if (!["CASH", "TRANSFER", "CARD", "QR", "OTHER"].includes(method)) {
        throw new Error(`Método de pago inválido: ${method}`);
      }

      totalPaid += amount;

      await Payment.create(
        {
          sale_id: sale.id,
          amount,
          method,
        },
        { transaction: t }
      );
    }

    // Si no mandan pagos, asumimos pagado exacto
    if (payments.length === 0) totalPaid = total;

    // 5) Actualizar totales finales
    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - total;
    await sale.save({ transaction: t });

    await t.commit();

    console.log(`✅ [POS] Venta #${sale.id} guardada.`);
    return res.json({ ok: true, data: sale });
  } catch (e) {
    if (t) await t.rollback();
    console.error("❌ [POS ERROR] Detalles:", e);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = { createSale };
