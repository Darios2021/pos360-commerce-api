// src/routes/admin.contenidos.routes.js
// Gestión de contenidos (videos para redes). Se monta en /admin/contenidos con
// requireAuth + attachAccessContext; acá se exige rol admin.
const router = require("express").Router();
const ctrl = require("../controllers/contenidos.controller");

router.use(ctrl.soloAdmin);

router.get("/fuente", ctrl.fuente);
router.get("/productos", ctrl.productos);
router.get("/voces", ctrl.voces);
router.post("/guion", ctrl.guion);
router.get("/piezas", ctrl.listar);
router.post("/piezas", ctrl.crear);
router.get("/piezas/:id", ctrl.ver);
router.patch("/piezas/:id", ctrl.editar);
router.delete("/piezas/:id", ctrl.borrar);
router.post("/piezas/:id/publicaciones", ctrl.publicar);

module.exports = router;
