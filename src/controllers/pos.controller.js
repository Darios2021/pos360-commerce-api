const { sequelize, Sale, SaleItem, Payment } = require("../models");

async function createSale(req, res, next) {
  let t;
  try {
    const { branch_id, user_id, customer_name, items, payments } = req.body;

    console.log("💰 [POS] Procesando venta...");

    t = await sequelize.transaction();

    // 1. Calculamos totales PREVIOS para poder crear la cabecera
    // (Aunque luego actualicemos, es mejor tener valores iniciales)
    let calculatedTotal = 0;
    items.forEach(i => {
      calculatedTotal += (Number(i.quantity) * Number(i.unit_price));
    });

    // 2. Crear Cabecera
    const sale = await Sale.create({
      branch_id: branch_id || 1, 
      user_id: user_id || 1,     
      customer_name: customer_name || "Consumidor Final",
      
      // Llenamos los campos obligatorios NO NULL de tu DB
      subtotal: calculatedTotal, // Asumimos subtotal = total por ahora (sin impuestos separados)
      tax_total: 0,
      discount_total: 0,
      total: calculatedTotal,
      
      paid_total: 0, // Lo actualizamos después de procesar pagos
      change_total: 0,
      
      status: 'PAID', 
      sold_at: new Date()
    }, { transaction: t });

    // 3. Insertar Items
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const lineTotal = qty * price;
      
      await SaleItem.create({
        sale_id: sale.id,
        product_id: item.product_id,
        quantity: qty,
        unit_price: price,
        
        // USAMOS EL NOMBRE CORRECTO DE LA DB
        line_total: lineTotal, 
        product_name_snapshot: item.product_name_snapshot || "Item"
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
        
        // USAMOS EL NOMBRE CORRECTO DE LA DB
        method: p.method 
      }, { transaction: t });
    }

    // 5. Actualizar totales finales
    sale.paid_total = totalPaid;
    sale.change_total = totalPaid - calculatedTotal; // Vuelto
    await sale.save({ transaction: t });

    await t.commit();

    console.log(`✅ [POS] Venta #${sale.id} guardada correctamente.`);
    
    res.json({ ok: true, data: sale });

  } catch (e) {
    if (t) await t.rollback();
    console.error("❌ [POS ERROR] Detalles:", e); // Esto mostrará el error exacto en consola
    res.status(500).json({ ok: false, message: e.message });
  }
}

module.exports = { createSale };