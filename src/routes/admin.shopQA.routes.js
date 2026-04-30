// =====================================================================
// admin.shopQA.routes.js
// Mount: /api/v1/admin/shop  (auth + access ya inyectados desde v1.routes)
// =====================================================================
const router = require("express").Router();
const ctrl = require("../controllers/admin.shopQA.controller");

// Summary para badges
router.get("/qa/summary", ctrl.summary);

// Questions
router.get("/questions", ctrl.listQuestions);
router.post("/questions/:id/answer", ctrl.answerQuestion);
router.patch("/questions/:id", ctrl.patchQuestion);
router.delete("/questions/:id", ctrl.deleteQuestion);

// Reviews
router.get("/reviews", ctrl.listReviews);
router.patch("/reviews/:id", ctrl.patchReview);
router.delete("/reviews/:id", ctrl.deleteReview);

module.exports = router;
