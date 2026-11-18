
import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middleware/auth.middleware.js";
import { listUsers, setUserBlocked, getStats, listTransactions } from "./admin.controller.js";

const router = Router();

// All admin routes require an authenticated admin
router.use(requireAuth, requireAdmin);

router.get("/users", listUsers);
router.patch("/users/:id/block", setUserBlocked);
router.get("/stats", getStats);
router.get("/transactions", listTransactions);

export default router;
