// =====================================================================
// admin.shopQA.controller.js
// =====================================================================
// Gestión admin de Preguntas y Respuestas + Reseñas del shop.
//
// Endpoints (montados bajo /api/v1/admin/shop):
//   GET    /questions                ?status=pending|answered|hidden|all  &q= &page= &limit=
//   POST   /questions/:id/answer     { answer }
//   PATCH  /questions/:id            { is_public }   // mostrar / ocultar
//   DELETE /questions/:id
//   GET    /reviews                  ?visibility=visible|hidden|all  &rating= &q= &page= &limit=
//   PATCH  /reviews/:id              { is_visible } // mostrar / ocultar
//   DELETE /reviews/:id
//   GET    /qa/summary               { questions_pending, reviews_hidden }   // badges
// =====================================================================

const db = require("../models");

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
function getAdminUserId(req) {
  return Number(req?.user?.id || req?.access?.userId || 0) || null;
}

const MAX_ANSWER = 1000;

/* =========================================================
   QUESTIONS
   ========================================================= */

async function listQuestions(req, res, next) {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    const q = clean(req.query.q, 120);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const offset = (page - 1) * limit;

    const conds = [];
    const repl = { lim: limit, off: offset };
    if (status === "pending") conds.push("q.is_public = 1 AND q.answer IS NULL");
    else if (status === "answered") conds.push("q.is_public = 1 AND q.answer IS NOT NULL");
    else if (status === "hidden") conds.push("q.is_public = 0");

    if (q) {
      conds.push("(q.text LIKE :qLike OR p.name LIKE :qLike OR c.first_name LIKE :qLike OR c.last_name LIKE :qLike OR c.email LIKE :qLike)");
      repl.qLike = `%${q}%`;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.sequelize.query(
      `SELECT
         q.id,
         q.product_id,
         p.name AS product_name,
         q.customer_id,
         CONCAT_WS(' ', NULLIF(c.first_name,''), NULLIF(c.last_name,'')) AS customer_name,
         c.email AS customer_email,
         q.text,
         q.answer,
         q.is_public,
         q.answered_at,
         q.answered_by_user_id,
         CONCAT_WS(' ', NULLIF(u.first_name,''), NULLIF(u.last_name,'')) AS answered_by_name,
         q.created_at,
         q.updated_at
       FROM product_questions q
       LEFT JOIN products p ON p.id = q.product_id
       LEFT JOIN ecom_customers c ON c.id = q.customer_id
       LEFT JOIN users u ON u.id = q.answered_by_user_id
       ${where}
       ORDER BY q.created_at DESC
       LIMIT :lim OFFSET :off`,
      { replacements: repl }
    );

    const [[{ total }]] = await db.sequelize.query(
      `SELECT COUNT(*) AS total
       FROM product_questions q
       LEFT JOIN products p ON p.id = q.product_id
       LEFT JOIN ecom_customers c ON c.id = q.customer_id
       ${where}`,
      { replacements: repl }
    );

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        product_id: Number(r.product_id),
        product_name: r.product_name || "",
        customer_id: Number(r.customer_id),
        customer_name: (r.customer_name || "").trim() || null,
        customer_email: r.customer_email || null,
        text: r.text || "",
        answer: r.answer || null,
        is_public: Number(r.is_public) === 1,
        answered_at: r.answered_at,
        answered_by_user_id: r.answered_by_user_id ? Number(r.answered_by_user_id) : null,
        answered_by_name: (r.answered_by_name || "").trim() || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      total: Number(total || 0),
      page,
      limit,
      pages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
    });
  } catch (e) {
    next(e);
  }
}

async function answerQuestion(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return fail(res, 400, "INVALID_ID", "id inválido");

    const answer = clean(req.body?.answer, MAX_ANSWER);
    if (!answer) return fail(res, 400, "INVALID_ANSWER", "Escribí una respuesta");

    const adminUserId = getAdminUserId(req);

    const [[exists]] = await db.sequelize.query(
      `SELECT id FROM product_questions WHERE id = :id LIMIT 1`,
      { replacements: { id } }
    );
    if (!exists) return fail(res, 404, "NOT_FOUND", "Pregunta inexistente");

    await db.sequelize.query(
      `UPDATE product_questions
       SET answer = :answer,
           answered_by_user_id = :uid,
           answered_at = NOW(),
           updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id, answer, uid: adminUserId } }
    );

    // Notificación in-app al cliente que hizo la pregunta (fire-and-forget).
    notifyCustomerQuestionAnswered(id, answer).catch((e) =>
      console.warn("[admin.shopQA] notifyCustomerQuestionAnswered falló:", e?.message)
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

/**
 * Notifica al cliente que su pregunta fue respondida. Genera una entrada
 * en customer_notifications que aparece en la campanita del shop.
 */
async function notifyCustomerQuestionAnswered(questionId, answerText) {
  try {
    const customerNotifs = require("../services/customerNotifications.service");
    const buildSlug = (() => {
      try {
        // Reusar el helper del frontend no se puede; replicamos slug simple.
        return (name, id) => {
          const base = String(name || "")
            .toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          return base ? `${base}-${id}` : String(id);
        };
      } catch { return (_, id) => String(id); }
    })();

    const [rows] = await db.sequelize.query(
      `SELECT q.id AS question_id, q.customer_id, q.text AS question_text,
              p.id AS product_id, p.name AS product_name
         FROM product_questions q
         LEFT JOIN products p ON p.id = q.product_id
        WHERE q.id = :id LIMIT 1`,
      { replacements: { id: questionId } }
    );
    const r = rows?.[0];
    if (!r || !r.customer_id) return;

    const productName = String(r.product_name || "tu producto").trim();
    const slug = buildSlug(productName, r.product_id);
    const link = `/shop/product/${slug}`;
    const shortAnswer = String(answerText || "").trim().slice(0, 220);

    await customerNotifs.create({
      customer_id: r.customer_id,
      type: "qa_answered",
      title: `Te respondieron en ${productName}`,
      body: shortAnswer,
      ref_type: "product_question",
      ref_id: r.question_id,
      link,
    });
  } catch (e) {
    console.warn("[admin.shopQA] notifyCustomerQuestionAnswered:", e?.message);
  }
}

async function patchQuestion(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return fail(res, 400, "INVALID_ID", "id inválido");

    const fields = [];
    const repl = { id };

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "is_public")) {
      fields.push("is_public = :ip");
      repl.ip = req.body.is_public ? 1 : 0;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "answer")) {
      const ans = clean(req.body.answer, MAX_ANSWER);
      fields.push("answer = :ans");
      repl.ans = ans || null;
      if (ans) {
        fields.push("answered_at = NOW()");
        const uid = getAdminUserId(req);
        if (uid) {
          fields.push("answered_by_user_id = :uid");
          repl.uid = uid;
        }
      }
    }

    if (!fields.length) return fail(res, 400, "NO_CHANGES", "No hay cambios");

    fields.push("updated_at = NOW()");

    await db.sequelize.query(
      `UPDATE product_questions SET ${fields.join(", ")} WHERE id = :id`,
      { replacements: repl }
    );

    // Si en este PATCH se setea answer (no vacío), también notificamos.
    if (repl.ans) {
      notifyCustomerQuestionAnswered(id, repl.ans).catch((e) =>
        console.warn("[admin.shopQA] notifyCustomerQuestionAnswered (patch) falló:", e?.message)
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

async function deleteQuestion(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return fail(res, 400, "INVALID_ID", "id inválido");

    await db.sequelize.query(
      `DELETE FROM product_questions WHERE id = :id`,
      { replacements: { id } }
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

/* =========================================================
   REVIEWS
   ========================================================= */

async function listReviews(req, res, next) {
  try {
    const visibility = String(req.query.visibility || "all").toLowerCase();
    const ratingFilter = toInt(req.query.rating, 0);
    const q = clean(req.query.q, 120);
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 25), 1), 100);
    const offset = (page - 1) * limit;

    const conds = [];
    const repl = { lim: limit, off: offset };
    if (visibility === "visible") conds.push("r.is_visible = 1");
    else if (visibility === "hidden") conds.push("r.is_visible = 0");

    if (ratingFilter >= 1 && ratingFilter <= 5) {
      conds.push("r.rating = :rt");
      repl.rt = ratingFilter;
    }
    if (q) {
      conds.push("(r.comment LIKE :qLike OR p.name LIKE :qLike OR c.first_name LIKE :qLike OR c.last_name LIKE :qLike OR c.email LIKE :qLike)");
      repl.qLike = `%${q}%`;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.sequelize.query(
      `SELECT
         r.id,
         r.product_id,
         p.name AS product_name,
         r.customer_id,
         CONCAT_WS(' ', NULLIF(c.first_name,''), NULLIF(c.last_name,'')) AS customer_name,
         c.email AS customer_email,
         r.rating,
         r.comment,
         r.is_verified_purchase,
         r.is_visible,
         r.created_at,
         r.updated_at
       FROM product_reviews r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN ecom_customers c ON c.id = r.customer_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT :lim OFFSET :off`,
      { replacements: repl }
    );

    const [[{ total }]] = await db.sequelize.query(
      `SELECT COUNT(*) AS total
       FROM product_reviews r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN ecom_customers c ON c.id = r.customer_id
       ${where}`,
      { replacements: repl }
    );

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        product_id: Number(r.product_id),
        product_name: r.product_name || "",
        customer_id: Number(r.customer_id),
        customer_name: (r.customer_name || "").trim() || null,
        customer_email: r.customer_email || null,
        rating: Number(r.rating),
        comment: r.comment || "",
        is_verified_purchase: Number(r.is_verified_purchase) === 1,
        is_visible: Number(r.is_visible) === 1,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      total: Number(total || 0),
      page,
      limit,
      pages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
    });
  } catch (e) {
    next(e);
  }
}

async function patchReview(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return fail(res, 400, "INVALID_ID", "id inválido");

    const fields = [];
    const repl = { id };

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "is_visible")) {
      fields.push("is_visible = :iv");
      repl.iv = req.body.is_visible ? 1 : 0;
    }

    if (!fields.length) return fail(res, 400, "NO_CHANGES", "No hay cambios");
    fields.push("updated_at = NOW()");

    await db.sequelize.query(
      `UPDATE product_reviews SET ${fields.join(", ")} WHERE id = :id`,
      { replacements: repl }
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

async function deleteReview(req, res, next) {
  try {
    const id = toInt(req.params.id, 0);
    if (!id) return fail(res, 400, "INVALID_ID", "id inválido");

    await db.sequelize.query(
      `DELETE FROM product_reviews WHERE id = :id`,
      { replacements: { id } }
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

/* =========================================================
   SUMMARY (badges para sidebar)
   ========================================================= */

async function summary(req, res, next) {
  try {
    const [[qPending]] = await db.sequelize.query(
      `SELECT COUNT(*) AS n FROM product_questions
       WHERE is_public = 1 AND answer IS NULL`
    );
    const [[rHidden]] = await db.sequelize.query(
      `SELECT COUNT(*) AS n FROM product_reviews WHERE is_visible = 0`
    );

    return res.json({
      ok: true,
      questions_pending: Number(qPending?.n || 0),
      reviews_hidden: Number(rHidden?.n || 0),
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listQuestions,
  answerQuestion,
  patchQuestion,
  deleteQuestion,
  listReviews,
  patchReview,
  deleteReview,
  summary,
};
