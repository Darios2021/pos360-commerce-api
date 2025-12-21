// src/routes/products.routes.js
const router = require("express").Router();

let ctrl;
try {
  ctrl = require("../controllers/products.controller.js");
} catch (e) {
  console.error("❌ Cannot require products.controller.js:", e?.message || e);
  throw e;
}

// ✅ Images controller
let imgCtrl;
try {
  imgCtrl = require("../controllers/productImages.controller.js");
} catch (e) {
  console.error("❌ Cannot require productImages.controller.js:", e?.message || e);
  throw e;
}

// tus logs (los dejo tal cual)
console.log("🧩 products.controller keys =", Object.keys(ctrl || {}));
console.log("🧩 typeof list =", typeof ctrl?.list);
console.log("🧩 typeof getOne =", typeof ctrl?.getOne);
console.log("🧩 typeof create =", typeof ctrl?.create);
console.log("🧩 typeof update =", typeof ctrl?.update);

// logs images
console.log("🧩 productImages.controller keys =", Object.keys(imgCtrl || {}));
console.log("🧩 typeof listImages =", typeof imgCtrl?.listImages);
console.log("🧩 typeof mwUpload =", typeof imgCtrl?.mwUpload);
console.log("🧩 typeof uploadImages =", typeof imgCtrl?.uploadImages);

// guard-rails (productos)
const mustBeFn = ["list", "getOne", "create", "update"];
for (const k of mustBeFn) {
  if (typeof ctrl?.[k] !== "function") {
    throw new Error(`❌ products.controller.${k} is not a function (is: ${typeof ctrl?.[k]})`);
  }
}

// guard-rails (imagenes)
const mustBeFnImg = ["listImages", "mwUpload", "uploadImages"];
for (const k of mustBeFnImg) {
  if (typeof imgCtrl?.[k] !== "function") {
    throw new Error(`❌ productImages.controller.${k} is not a function (is: ${typeof imgCtrl?.[k]})`);
  }
}

// CRUD Productos
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);

// ✅ IMÁGENES (persisten en MinIO + DB)
router.get("/:id/images", imgCtrl.listImages);
router.post("/:id/images", imgCtrl.mwUpload, imgCtrl.uploadImages);

module.exports = router;
