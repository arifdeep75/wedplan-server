
import { Router } from "express";
import { listServices } from "./service.controller.js";

const router = Router();

// Public: browse approved + active services
router.get("/", listServices);

export default router;
