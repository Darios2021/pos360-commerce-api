// src/services/public.service.js
// ✅ COPY-PASTE FINAL
// FIX ML: category_id (rubro padre) incluye hijos via categories.parent_id

const { sequelize } = require("../models");

function escLike(s) {
  return String(s).replace(/[%_]/g, (m) => "\\" + m);
}

function pad6(n) {
  const s = String(n);
  return s.length >= 6 ? s : "0".repeat(6 - s.length) + s;
}

module.exports = {
  async listBranches() {
    const [rows] = await sequelize.query(`
      SELECT id, name, code, address, city
      FROM branches
      WHERE is_active = 1
      ORDER BY name ASC
    `);
    return rows || [];
  },
async listCatalog({ branch_id, search, category_id, include_children, in_stock, page, limit }) {
  const where = ["branch_id = :branch_id"];
  const repl = { branch_id, limit, offset: (page - 1) * limit };

  // ✅ Categorías estilo inventario:
  // - Si include_children=1 y category_id es padre -> trae padre + hijos (subrubros)
  // - Si include_children=0 -> filtra exacto por category_id (subrubro)
  if (category_id) {
    if (include_children) {
      where.push(`
        category_id IN (
          SELECT id FROM categories
          WHERE id = :cat_id OR parent_id = :cat_id
        )
      `);
      repl.cat_id = category_id;
    } else {
      where.push("category_id = :category_id");
      repl.category_id = category_id;
    }
  }

  if (search) {
    repl.q = `%${escLike(search)}%`;
    where.push(`
      (name LIKE :q ESCAPE '\\'
      OR brand LIKE :q ESCAPE '\\'
      OR model LIKE :q ESCAPE '\\'
      OR sku LIKE :q ESCAPE '\\'
      OR barcode LIKE :q ESCAPE '\\')
    `);
  }

  if (in_stock) where.push("(track_stock = 0 OR stock_qty > 0)");

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [[countRow]] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM v_public_catalog ${whereSql}`,
    { replacements: repl }
  );

  const [items] = await sequelize.query(
    `SELECT * FROM v_public_catalog ${whereSql}
     ORDER BY product_id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements: repl }
  );

  const total = Number(countRow?.total || 0);
  return { items, page, limit, total, pages: total ? Math.ceil(total / limit) : 0 };
},







  async getProductById({ branch_id, product_id }) {
    const [rows] = await sequelize.query(
      `SELECT * FROM v_public_catalog
       WHERE branch_id = :branch_id AND product_id = :product_id
       LIMIT 1`,
      { replacements: { branch_id, product_id } }
    );
    return rows?.[0] || null;
  },

  // ✅ Crear pedido Ecommerce (sin pago)
  async createOrder({ branch_id, items, customer, fulfillment, notes }) {
    return await sequelize.transaction(async (t) => {
      // 1) Validar productos vs catálogo (incluye precios + track_stock + stock_qty)
      const productIds = [...new Set(items.map((i) => i.product_id))];

      const [rows] = await sequelize.query(
        `
        SELECT product_id, name, track_stock, stock_qty, price_list, price_discount, price
        FROM v_public_catalog
        WHERE branch_id = :branch_id
          AND product_id IN (:ids)
        `,
        { replacements: { branch_id, ids: productIds }, transaction: t }
      );

      const map = new Map(rows.map((r) => [Number(r.product_id), r]));

      // 2) Armar líneas y chequear stock
      const lines = [];
      let subtotal = 0;

      for (const it of items) {
        const p = map.get(Number(it.product_id));
        if (!p) {
          throw new Error(`Producto inválido o no pertenece a la sucursal: ${it.product_id}`);
        }

        const qty = Number(it.qty);

        // precio final: si hay discount > 0 usarlo, sino price_list, sino price
        const unit_price =
          Number(p.price_discount) > 0
            ? Number(p.price_discount)
            : Number(p.price_list) > 0
            ? Number(p.price_list)
            : Number(p.price);

        if (Number(p.track_stock) === 1) {
          const available = Number(p.stock_qty);
          if (qty > available) {
            throw new Error(`Sin stock suficiente para "${p.name}". Disponible: ${available}`);
          }
        }

        const line_total = Number((unit_price * qty).toFixed(2));
        subtotal += line_total;

        lines.push({
          product_id: Number(it.product_id),
          qty,
          unit_price,
          line_total,
        });
      }

      subtotal = Number(subtotal.toFixed(2));
      const discount_total = 0;
      const shipping_total = 0;
      const total = Number((subtotal - discount_total + shipping_total).toFixed(2));

      // 3) Upsert customer (por email si viene)
      let customer_id = null;
      const email = String(customer?.email || "").trim().toLowerCase();

      if (email) {
        const [existing] = await sequelize.query(
          `SELECT id FROM ecom_customers WHERE email = :email LIMIT 1`,
          { replacements: { email }, transaction: t }
        );

        if (existing?.length) {
          customer_id = Number(existing[0].id);
          await sequelize.query(
            `
            UPDATE ecom_customers
            SET first_name = :first_name,
                last_name = :last_name,
                phone = :phone,
                doc_number = :doc_number,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id
            `,
            {
              replacements: {
                id: customer_id,
                first_name: customer.first_name || null,
                last_name: customer.last_name || null,
                phone: customer.phone || null,
                doc_number: customer.doc_number || null,
              },
              transaction: t,
            }
          );
        } else {
          await sequelize.query(
            `
            INSERT INTO ecom_customers (email, first_name, last_name, phone, doc_number, created_at, updated_at)
            VALUES (:email, :first_name, :last_name, :phone, :doc_number, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            {
              replacements: {
                email,
                first_name: customer.first_name || null,
                last_name: customer.last_name || null,
                phone: customer.phone || null,
                doc_number: customer.doc_number || null,
              },
              transaction: t,
            }
          );

          // recuperar id con SELECT seguro
          const [row2] = await sequelize.query(
            `SELECT id FROM ecom_customers WHERE email = :email LIMIT 1`,
            { replacements: { email }, transaction: t }
          );
          customer_id = row2?.[0]?.id ? Number(row2[0].id) : null;
        }
      }

      // 4) Insert order con public_code temporal
      await sequelize.query(
        `
        INSERT INTO ecom_orders
          (public_code, branch_id, customer_id, status, currency,
           subtotal, discount_total, shipping_total, total,
           fulfillment_type, ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_province, ship_zip,
           notes, created_at, updated_at)
        VALUES
          ('TMP', :branch_id, :customer_id, 'created', 'ARS',
           :subtotal, :discount_total, :shipping_total, :total,
           :fulfillment_type, :ship_name, :ship_phone, :ship_address1, :ship_address2, :ship_city, :ship_province, :ship_zip,
           :notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        {
          replacements: {
            branch_id,
            customer_id,
            subtotal,
            discount_total,
            shipping_total,
            total,
            fulfillment_type: fulfillment?.type || "pickup",
            ship_name: fulfillment?.ship_name || null,
            ship_phone: fulfillment?.ship_phone || null,
            ship_address1: fulfillment?.ship_address1 || null,
            ship_address2: fulfillment?.ship_address2 || null,
            ship_city: fulfillment?.ship_city || null,
            ship_province: fulfillment?.ship_province || null,
            ship_zip: fulfillment?.ship_zip || null,
            notes: notes || null,
          },
          transaction: t,
        }
      );

      // Obtener order_id de forma segura
      const [[orderRow]] = await sequelize.query(
        `SELECT id FROM ecom_orders ORDER BY id DESC LIMIT 1`,
        { transaction: t }
      );
      const order_id = Number(orderRow.id);

      // 5) Generar public_code (EC-YYYY-000001)
      const year = new Date().getFullYear();
      const public_code = `EC-${year}-${pad6(order_id)}`;

      await sequelize.query(
        `UPDATE ecom_orders SET public_code = :public_code WHERE id = :id`,
        { replacements: { public_code, id: order_id }, transaction: t }
      );

      // 6) Insert items
      for (const ln of lines) {
        await sequelize.query(
          `
          INSERT INTO ecom_order_items
            (order_id, product_id, qty, unit_price, line_total, created_at, updated_at)
          VALUES
            (:order_id, :product_id, :qty, :unit_price, :line_total, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          {
            replacements: {
              order_id,
              product_id: ln.product_id,
              qty: ln.qty,
              unit_price: ln.unit_price,
              line_total: ln.line_total,
            },
            transaction: t,
          }
        );
      }

      return {
        order: {
          id: order_id,
          public_code,
          branch_id,
          customer_id,
          status: "created",
          currency: "ARS",
          subtotal,
          discount_total,
          shipping_total,
          total,
        },
        items: lines,
      };
    });
  },
};
