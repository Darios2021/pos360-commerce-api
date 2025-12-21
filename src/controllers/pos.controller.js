const { sequelize, Sale, SaleItem, Payment } = require("../models");

async function createSale(req, res, next) {
  let t;
  try {
    const { branch_id, user_id, customer_name, items, payments } = req.body;

    console.log("💰 [POS] Procesando venta...");

    // 1. Iniciar Transacción
    t = await sequelize.transaction();

    // 2. Crear Cabecera (Estado 'PAID' según tu ENUM)
    const sale = await Sale.create({
      branch_id: branch_id || 1, 
      user_id: user_id || 1,     
      customer_name: customer_name || "Consumidor Final",
      total: 0, 
      paid_total: 0, // Importante inicializar
      status: 'PAID', // ✅ Ajustado a tu ENUM
      sold_at: new Date()
    }, { transaction: t });

    let calculatedTotal = 0;

    // 3. Insertar Items
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const subtotal = qty * price;
      
      calculatedTotal += subtotal;

      await SaleItem.create({
        sale_id: sale.id,
        product_id: item.product_id,
        quantity: qty,
        unit_price: price,
        line_total: subtotal, // ✅ Tu tabla usa line_total, no subtotal
        // Si el frontend enviara el nombre, lo guardaríamos aquí:
        // product_name_snapshot: item.name 
      }, { transaction: t });
    }

    // 4. Insertar Pagos
    let totalPaid = 0;
    for (const p of payments) {
      const amount = Number(p.amount);
      totalPaid += amount;

      await Payment.create({
        sale_id: sale.id,
        amount: amount,
        method: p.method // ✅ Tu tabla usa 'method'
      }, { transaction: t });
    }

    // 5. Actualizar totales finales en la cabecera
    sale.total = calculatedTotal;
    sale.paid_total = totalPaid; // ✅ Llenamos paid_total según tu esquema
    
    // Si pagó menos del total, podríamos cambiar estado, pero por ahora asumimos PAID
    if (totalPaid >= calculatedTotal) {
        sale.status = 'PAID';
    } else {
        sale.status = 'DRAFT'; // O lo dejamos en PAID según tu lógica de negocio
    }

    await sale.save({ transaction: t });

    // 6. Commit
    await t.commit();

    console.log(`✅ [POS] Venta #${sale.id} guardada. Total: $${calculatedTotal}`);
    
    res.json({ ok: true, data: sale });

  } catch (e) {
    if (t) await t.rollback();
    console.error("❌ [POS ERROR]", e);
    // Mejorar el mensaje de error para el frontend
    res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = { createSale };