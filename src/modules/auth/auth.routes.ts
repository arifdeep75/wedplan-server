
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";

const router = Router();

router.get("/me", requireAuth, (_req, res) => {
  res.status(200).json({
    success: true,
    user: res.locals.user,
  });
});

export default router;
