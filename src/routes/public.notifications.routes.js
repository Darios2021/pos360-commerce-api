// src/routes/public.notifications.routes.js
const router = require("express").Router();
const c = require("../controllers/public.notifications.controller");

router.get("/notifications", c.list);
router.get("/notifications/unread-count", c.unreadCount);
router.post("/notifications/read-all", c.markAllRead);
router.post("/notifications/:id/read", c.markRead);

module.exports = router;
