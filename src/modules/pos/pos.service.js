// src/modules/pos/pos.service.js
const { QueryTypes } = require("sequelize");
const { initPosModels } = require("./pos.models");

function toNumber(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((toNumber(n, 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Crea una venta POS y descuenta stock (warehouse-based)
 * TODO en transacción:
 *  - valida stock_balances (FOR UPDATE)
 *  - crea sales, sale_items, payments
 *  - crea stock_movements (type=out) + stock_movement_items
 *  - actualiza stock_balances.qty
 */
async function createPosSale(payload, ctxUser) {
  const { sequelize, Sale, SaleItem, Payment } = initPosModels();

  const userId = ctxUser?.id ?? payload.user_id ?? null;
  if (!userId) {
    const err = new Error("Missing user_id (req.user.id o payload.user_id)");
    err.status = 400;
    throw err;
  }

  const branchId = payload.branch_id;
  if (!branchId) {
    const err = new Error("Missing branch_id");
    err.status = 400;
    throw err;
  }

  const cashRegisterId = payload.cash_register_id ?? null;

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    const err = new Error("items vacío");
    err.status = 400;
    throw err;
  }

  // Requerimos warehouse_id por item o a nivel payload
  const defaultWarehouseId = payload.warehouse_id ?? null;

  // payments opcional (si no mandan, asumimos CASH total exacto)
  const paymentsIn = Array.isArray(payload.payments) ? payload.payments : [];

  // Totales
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let total = 0;

  return await sequelize.transaction(async (t) => {
    // 1) Validación y locks de stock
    // Agrupar por warehouse+product para validar stock una sola vez
    const needMap = new Map(); // key `${warehouseId}:${productId}` => qty
    for (const it of items) {
      const productId = it.product_id;
      const warehouseId = it.warehouse_id ?? defaultWarehouseId;
      const qty = toNumber(it.quantity ?? it.qty, 0);

      if (!productId) {
        const err = new Error("Item missing product_id");
        err.status = 400;
        throw err;
      }
      if (!warehouseId) {
        const err = new Error(`Item product_id=${productId}: missing warehouse_id`);
        err.status = 400;
        throw err;
      }
      if (qty <= 0) {
        const err = new Error(`Item product_id=${productId}: invalid quantity`);
        err.status = 400;
        throw err;
      }

      const k = `${warehouseId}:${productId}`;
      needMap.set(k, toNumber(needMap.get(k), 0) + qty);
    }

    // Lock rows in stock_balances
    for (const [k, needQty] of needMap.entries()) {
      const [warehouseIdStr, productIdStr] = k.split(":");
      const warehouseId = Number(warehouseIdStr);
      const productId = Number(productIdStr);

      const rows = await sequelize.query(
        `
        SELECT id, qty
        FROM stock_balances
        WHERE warehouse_id = :warehouse_id AND product_id = :product_id
        FOR UPDATE
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { warehouse_id: warehouseId, product_id: productId },
          transaction: t,
        }
      );

      if (rows.length === 0) {
        const err = new Error(`Sin stock_balance para warehouse_id=${warehouseId} product_id=${productId}`);
        err.status = 409;
        throw err;
      }

      const currentQty = toNumber(rows[0].qty, 0);
      if (currentQty < needQty) {
        const err = new Error(
          `Stock insuficiente: warehouse_id=${warehouseId} product_id=${productId} disponible=${currentQty} requerido=${needQty}`
        );
        err.status = 409;
        throw err;
      }
    }

    // 2) Pre-cálculo de items y snapshots de productos
    const preparedItems = [];
    for (const it of items) {
      const productId = it.product_id;
      const warehouseId = it.warehouse_id ?? defaultWarehouseId;

      const qty = toNumber(it.quantity ?? it.qty, 0);
      const unitPrice = round2(it.unit_price ?? it.price ?? 0);
      const discountAmount = round2(it.discount_amount ?? 0);
      const taxAmount = round2(it.tax_amount ?? 0);

      const lineSub = round2(qty * unitPrice);
      const lineTotal = round2(lineSub - discountAmount + taxAmount);

      subtotal = round2(subtotal + lineSub);
      discountTotal = round2(discountTotal + discountAmount);
      taxTotal = round2(taxTotal + taxAmount);
      total = round2(total + lineTotal);

      // snapshot product
      const prodRows = await sequelize.query(
        `SELECT name, sku, barcode FROM products WHERE id = :id LIMIT 1`,
        { type: QueryTypes.SELECT, replacements: { id: productId }, transaction: t }
      );
      const snap = prodRows[0] || {};

      preparedItems.push({
        product_id: productId,
        warehouse_id: warehouseId,
        quantity: qty,
        unit_price: unitPrice,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        line_total: lineTotal,
        product_name_snapshot: snap.name ?? null,
        product_sku_snapshot: snap.sku ?? null,
        product_barcode_snapshot: snap.barcode ?? null,
      });
    }

    // 3) Pagos
    let payments = paymentsIn;
    if (payments.length === 0) {
      payments = [{ method: "CASH", amount: total }];
    }

    const paidTotal = round2(payments.reduce((acc, p) => acc + toNumber(p.amount, 0), 0));
    const changeTotal = paidTotal > total ? round2(paidTotal - total) : 0;

    // 4) Crear Sale
    const sale = await Sale.create(
      {
        branch_id: branchId,
        cash_register_id: cashRegisterId,
        user_id: userId,

        status: "PAID",
        sale_number: payload.sale_number ?? null,

        customer_name: payload.customer_name ?? null,
        customer_doc: payload.customer_doc ?? null,
        customer_phone: payload.customer_phone ?? null,

        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        total,
        paid_total: paidTotal,
        change_total: changeTotal,

        note: payload.note ?? null,
        sold_at: payload.sold_at ?? new Date(),
      },
      { transaction: t }
    );

    // 5) Crear SaleItems
    for (const pi of preparedItems) {
      await SaleItem.create(
        {
          sale_id: sale.id,
          ...pi,
        },
        { transaction: t }
      );
    }

    // 6) Crear Payments
    for (const p of payments) {
      await Payment.create(
        {
          sale_id: sale.id,
          method: (p.method ?? "CASH").toUpperCase(),
          amount: round2(p.amount ?? 0),
          reference: p.reference ?? null,
          note: p.note ?? null,
          paid_at: p.paid_at ?? new Date(),
        },
        { transaction: t }
      );
    }

    // 7) Crear stock_movement (type='out')
    const refType = "sale";
    const refId = String(sale.id);

    // Elegimos warehouse_id principal si viene a nivel payload, sino el del primer item
    const movementWarehouseId = defaultWarehouseId ?? preparedItems[0].warehouse_id;

    const [_, metaMove] = await sequelize.query(
      `
      INSERT INTO stock_movements
        (type, warehouse_id, from_warehouse_id, to_warehouse_id, ref_type, ref_id, note, created_by, created_at)
      VALUES
        ('out', :warehouse_id, :from_warehouse_id, NULL, :ref_type, :ref_id, :note, :created_by, NOW())
      `,
      {
        transaction: t,
        replacements: {
          warehouse_id: movementWarehouseId,
          from_warehouse_id: movementWarehouseId,
          ref_type: refType,
          ref_id: refId,
          note: payload.stock_note ?? `POS sale #${sale.id}`,
          created_by: userId,
        },
      }
    );

    const movementId = metaMove?.insertId;
    if (!movementId) {
      const err = new Error("No se pudo crear stock_movements (insertId vacío)");
      err.status = 500;
      throw err;
    }

    // 8) Insert stock_movement_items y actualizar stock_balances
    for (const pi of preparedItems) {
      await sequelize.query(
        `
        INSERT INTO stock_movement_items
          (movement_id, product_id, qty, unit_cost, created_at)
        VALUES
          (:movement_id, :product_id, :qty, NULL, NOW())
        `,
        {
          transaction: t,
          replacements: {
            movement_id: movementId,
            product_id: pi.product_id,
            qty: pi.quantity,
          },
        }
      );

      // Update balance (ya está lockeado por FOR UPDATE en la validación)
      await sequelize.query(
        `
        UPDATE stock_balances
        SET qty = qty - :qty, updated_at = NOW()
        WHERE warehouse_id = :warehouse_id AND product_id = :product_id
        `,
        {
          transaction: t,
          replacements: {
            qty: pi.quantity,
            warehouse_id: pi.warehouse_id,
            product_id: pi.product_id,
          },
        }
      );
    }

    // 9) Devuelve venta completa
    const full = await Sale.findByPk(sale.id, {
      transaction: t,
      include: [
        { association: "items" },
        { association: "payments" },
      ],
    });

    return {
      sale: full,
      stock_movement_id: movementId,
    };
  });
}

module.exports = { createPosSale };
