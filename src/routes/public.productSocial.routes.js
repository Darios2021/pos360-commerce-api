// =====================================================================
// public.productSocial.routes.js
// Q&A + Reviews del shop público (preguntas, respuestas y opiniones).
// Se monta bajo /api/v1/public/products
// =====================================================================
const router = require("express").Router();

const ctrl = require("../controllers/shopProductSocial.controller");
const {
  requireShopCustomer,
  hydrateShopCustomer,
} = require("../middlewares/shopCustomerAuth.middleware");

// ── Preguntas ──
router.get("/:id/questions", ctrl.listQuestions);
router.post("/:id/questions", requireShopCustomer, ctrl.createQuestion);

// ── Reviews ──
router.get("/:id/reviews", ctrl.listReviews);
// summary expone flags si el customer está logueado (puede o no estarlo)
router.get("/:id/reviews/summary", hydrateShopCustomer, ctrl.reviewsSummary);
router.post("/:id/reviews", requireShopCustomer, ctrl.createReview);

module.exports = router;
