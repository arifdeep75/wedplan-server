
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { updateProfile } from "./profile.controller.js";

const router = Router();

// Authenticated: update own profile (name, image, business name for vendors)
router.patch("/me", requireAuth, updateProfile);

export default router;
