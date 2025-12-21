// src/controllers/pos.controller.js
const { sequelize, Sale, SaleItem, Payment } = require("../models");

const ALLOWED_METHODS = new Set(["CASH", "TRANSFER", "CARD", "QR", "OTHER"]);

async function createSale(req, res) {
  let t;
  try {
    const { branch_id, user_id, customer_name, items, payments } = req.body;

    console.log("💰 [POS] Procesando venta...");
    console.log("BODY:", JSON.stringify(req.body, null, 2));

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Venta sin items" });
    }

    const paymentsSafe = Array.isArray(payments) ? payments : [];

    t = await sequelize.transaction();

    // 1) Total
    let calculatedTotal = 0;
    for (const i of items) {
      const q = Number(i.quantity ?? 0);
      const p = Number(i.unit_price ?? 0);
      if (!Number.isFinite(q) || q <= 0) throw new Error(`Item inválido quantity=${i.quantity}`);
      if (!Number.isFinite(p) || p <= 0) throw new Error(`Item inválido unit_price=${i.unit_price}`);
      if (!i.product_id) throw new Error("Item inválido: falta product_id");
      calculatedTotal += q * p;
    }

    // 2) Cabecera
    const sale = await Sale.create(
      {
        branch_id: Number(branch_id) || 1,
        user_id: Number(user_id) || 1,
        customer_name: customer_name || "Consumidor Final",

        subtotal: calculatedTotal,
        tax_total: 0,
        discount_total: 0,
        total: calculatedTotal,

        paid_total: 0,
        change_total: 0,

        status: "PAID",
        sold_at: new Date(),
      },
      { transaction: t }
    );

    // 3) Items
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const lineTotal = qty * price;

      await SaleItem.create(
        {
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: qty,
          unit_price: price,
          line_total: lineTotal,
          product_name_snapshot: item.product_name_snapshot || item.product_name || "Item",
        },
        { transaction: t }
      );
    }

    // 4) Pagos
    let totalPaid = 0;

    for (const p of paymentsSafe) {
      const amount = Number(p.amount ?? 0);
      const method = String(p.method || "CASH").toUpperCase();

      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Pago inválido amount=${p.amount}`);
      if (!ALLOWED_METHODS.has(method)) throw new Error(`Pago inválido method=${method}`);

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

    // Si no mandaron pagos, asumimos pagado exacto (para no romper flujo)
    if (paymentsSafe.length === 0) {
      totalPaid = calculatedTotal;
    }

    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - calculatedTotal;
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
