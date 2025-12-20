// src/routes/products.routes.js
const router = require("express").Router();

let ctrl;
try {
  ctrl = require("../controllers/products.controller.js");
} catch (e) {
  console.error("❌ Cannot require products.controller.js:", e?.message || e);
  throw e;
}

console.log("🧩 products.controller keys =", Object.keys(ctrl || {}));
console.log("🧩 typeof list =", typeof ctrl?.list);
console.log("🧩 typeof getOne =", typeof ctrl?.getOne);
console.log("🧩 typeof create =", typeof ctrl?.create);
console.log("🧩 typeof update =", typeof ctrl?.update);

// Si alguno no es function, lo frenamos nosotros con mensaje claro
const mustBeFn = ["list", "getOne", "create", "update"];
for (const k of mustBeFn) {
  if (typeof ctrl?.[k] !== "function") {
    throw new Error(`❌ products.controller.${k} is not a function (is: ${typeof ctrl?.[k]})`);
  }
}

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

module.exports = router;
