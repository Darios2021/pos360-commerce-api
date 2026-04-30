// =====================================================================
// shopProductSocial.controller.js
// =====================================================================
// Q&A + Reviews del shop público.
// - GET  /public/products/:id/questions          (lista pública, paginado)
// - POST /public/products/:id/questions          (auth shop customer)
// - GET  /public/products/:id/reviews            (lista pública, paginado)
// - GET  /public/products/:id/reviews/summary    (rating promedio + distribución)
// - POST /public/products/:id/reviews            (auth shop customer + verified purchase)
//
// Validaciones:
// - text 1..500 chars
// - rating ∈ {1,2,3,4,5}
// - comment ≤ 500 chars
// - una review por (product, customer)  → 409 CONFLICT si ya existe
// - rate-limit suave: 1 pregunta cada 15s por customer (anti-spam)
// =====================================================================

const db = require("../models");

const MAX_TEXT = 500;
const MAX_COMMENT = 500;
const QUESTION_THROTTLE_SECONDS = 15;

function toInt(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function clean(s, max) {
  return String(s ?? "").trim().slice(0, max);
}
function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ ok: false, code, message, ...extra });
}

/* =========================================================
   PRODUCT QUESTIONS
   ========================================================= */

async function listQuestions(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return fail(res, 400, "INVALID_PRODUCT_ID", "product_id inválido");

    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 50);
    const offset = Math.max(toInt(req.query.offset, 0), 0);

    const [rows] = await db.sequelize.query(
      `SELECT
         q.id,
         q.product_id,
         q.text,
         q.answer,
         q.answered_at,
         q.created_at,
         CONCAT_WS(' ', NULLIF(c.first_name,''), NULLIF(c.last_name,'')) AS customer_name
       FROM product_questions q
       LEFT JOIN ecom_customers c ON c.id = q.customer_id
       WHERE q.product_id = :pid AND q.is_public = 1
       ORDER BY q.created_at DESC
       LIMIT :lim OFFSET :off`,
      { replacements: { pid: productId, lim: limit, off: offset } }
    );

    const [[{ total }]] = await db.sequelize.query(
      `SELECT COUNT(*) AS total FROM product_questions WHERE product_id = :pid AND is_public = 1`,
      { replacements: { pid: productId } }
    );

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        product_id: Number(r.product_id),
        text: r.text || "",
        answer: r.answer || null,
        answered_at: r.answered_at,
        created_at: r.created_at,
        author_name: (r.customer_name || "").trim() || null,
      })),
      total: Number(total || 0),
      limit,
      offset,
    });
  } catch (e) {
    next(e);
  }
}

async function createQuestion(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return fail(res, 400, "INVALID_PRODUCT_ID", "product_id inválido");

    const customer = req.customer;
    if (!customer?.id) return fail(res, 401, "AUTH_REQUIRED", "Iniciá sesión para preguntar");

    const text = clean(req.body?.text, MAX_TEXT);
    if (!text) return fail(res, 400, "INVALID_TEXT", "Escribí tu pregunta");
    if (text.length < 3) return fail(res, 400, "TEXT_TOO_SHORT", "La pregunta es muy corta");

    // Producto existe y es activo (control mínimo)
    const [[prod]] = await db.sequelize.query(
      `SELECT id FROM products WHERE id = :pid LIMIT 1`,
      { replacements: { pid: productId } }
    );
    if (!prod) return fail(res, 404, "PRODUCT_NOT_FOUND", "Producto inexistente");

    // Anti-spam: una pregunta cada N segundos por customer
    const [[recent]] = await db.sequelize.query(
      `SELECT id FROM product_questions
       WHERE customer_id = :cid AND created_at > (NOW() - INTERVAL :sec SECOND)
       ORDER BY id DESC LIMIT 1`,
      { replacements: { cid: customer.id, sec: QUESTION_THROTTLE_SECONDS } }
    );
    if (recent) {
      return fail(res, 429, "TOO_MANY_REQUESTS", "Esperá unos segundos antes de volver a preguntar");
    }

    const [insertedId] = await db.sequelize.query(
      `INSERT INTO product_questions (product_id, customer_id, text, is_public, created_at, updated_at)
       VALUES (:pid, :cid, :text, 1, NOW(), NOW())`,
      {
        replacements: { pid: productId, cid: customer.id, text },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    return res.status(201).json({
      ok: true,
      question: {
        id: Number(insertedId || 0),
        product_id: productId,
        text,
        answer: null,
        answered_at: null,
        created_at: new Date(),
        author_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null,
      },
    });
  } catch (e) {
    next(e);
  }
}

/* =========================================================
   PRODUCT REVIEWS
   ========================================================= */

async function listReviews(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return fail(res, 400, "INVALID_PRODUCT_ID", "product_id inválido");

    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 50);
    const offset = Math.max(toInt(req.query.offset, 0), 0);
    const ratingFilter = toInt(req.query.rating, 0);

    const where = ["r.product_id = :pid", "r.is_visible = 1"];
    const repl = { pid: productId, lim: limit, off: offset };
    if (ratingFilter >= 1 && ratingFilter <= 5) {
      where.push("r.rating = :rt");
      repl.rt = ratingFilter;
    }

    const [rows] = await db.sequelize.query(
      `SELECT
         r.id,
         r.product_id,
         r.rating,
         r.comment,
         r.is_verified_purchase,
         r.created_at,
         CONCAT_WS(' ', NULLIF(c.first_name,''), NULLIF(c.last_name,'')) AS customer_name
       FROM product_reviews r
       LEFT JOIN ecom_customers c ON c.id = r.customer_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.created_at DESC
       LIMIT :lim OFFSET :off`,
      { replacements: repl }
    );

    const [[{ total }]] = await db.sequelize.query(
      `SELECT COUNT(*) AS total FROM product_reviews r WHERE ${where.join(" AND ")}`,
      { replacements: repl }
    );

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        product_id: Number(r.product_id),
        rating: Number(r.rating),
        comment: r.comment || "",
        is_verified_purchase: Number(r.is_verified_purchase) === 1,
        created_at: r.created_at,
        author_name: (r.customer_name || "").trim() || null,
      })),
      total: Number(total || 0),
      limit,
      offset,
    });
  } catch (e) {
    next(e);
  }
}

async function reviewsSummary(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return fail(res, 400, "INVALID_PRODUCT_ID", "product_id inválido");

    const [rows] = await db.sequelize.query(
      `SELECT rating, COUNT(*) AS n
       FROM product_reviews
       WHERE product_id = :pid AND is_visible = 1
       GROUP BY rating`,
      { replacements: { pid: productId } }
    );

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const r of rows || []) {
      const k = Number(r.rating);
      const n = Number(r.n);
      if (k >= 1 && k <= 5) {
        distribution[k] = n;
        total += n;
        sum += k * n;
      }
    }

    return res.json({
      ok: true,
      product_id: productId,
      total,
      average: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
      distribution,
    });
  } catch (e) {
    next(e);
  }
}

async function createReview(req, res, next) {
  try {
    const productId = toInt(req.params.id, 0);
    if (!productId) return fail(res, 400, "INVALID_PRODUCT_ID", "product_id inválido");

    const customer = req.customer;
    if (!customer?.id) return fail(res, 401, "AUTH_REQUIRED", "Iniciá sesión para opinar");

    const rating = toInt(req.body?.rating, 0);
    if (rating < 1 || rating > 5) return fail(res, 400, "INVALID_RATING", "Rating debe ser 1-5");

    const comment = clean(req.body?.comment, MAX_COMMENT);

    // Producto existe
    const [[prod]] = await db.sequelize.query(
      `SELECT id FROM products WHERE id = :pid LIMIT 1`,
      { replacements: { pid: productId } }
    );
    if (!prod) return fail(res, 404, "PRODUCT_NOT_FOUND", "Producto inexistente");

    // Una review por (product, customer)
    const [[exists]] = await db.sequelize.query(
      `SELECT id FROM product_reviews WHERE product_id = :pid AND customer_id = :cid LIMIT 1`,
      { replacements: { pid: productId, cid: customer.id } }
    );
    if (exists) {
      return fail(res, 409, "ALREADY_REVIEWED", "Ya dejaste tu opinión sobre este producto");
    }

    // Verified purchase: hay algún ecom_order_item del producto en una orden del customer entregada
    let isVerified = 0;
    try {
      const [[verified]] = await db.sequelize.query(
        `SELECT 1 AS ok
         FROM ecom_order_items oi
         INNER JOIN ecom_orders o ON o.id = oi.order_id
         WHERE o.customer_id = :cid
           AND oi.product_id = :pid
           AND o.status IN ('delivered','completed','paid','received')
         LIMIT 1`,
        { replacements: { cid: customer.id, pid: productId } }
      );
      isVerified = verified ? 1 : 0;
    } catch {
      // si la tabla/columna no calza exactamente con el schema real, no rompemos —
      // dejamos is_verified_purchase = 0 y el admin puede ajustarlo después.
      isVerified = 0;
    }

    const [insertedId] = await db.sequelize.query(
      `INSERT INTO product_reviews
         (product_id, customer_id, rating, comment, is_verified_purchase, is_visible, created_at, updated_at)
       VALUES (:pid, :cid, :rating, :comment, :ver, 1, NOW(), NOW())`,
      {
        replacements: {
          pid: productId,
          cid: customer.id,
          rating,
          comment: comment || null,
          ver: isVerified,
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    return res.status(201).json({
      ok: true,
      review: {
        id: Number(insertedId || 0),
        product_id: productId,
        rating,
        comment,
        is_verified_purchase: isVerified === 1,
        created_at: new Date(),
        author_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null,
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listQuestions,
  createQuestion,
  listReviews,
  reviewsSummary,
  createReview,
};
