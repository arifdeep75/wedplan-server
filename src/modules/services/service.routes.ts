
import { Router } from "express";
import { requireAuth, requireVendor, requireAdmin } from "../../middleware/auth.middleware.js";
import {
  listServices,
  getServiceById,
  createService,
  listMyServices,
  updateService,
  deleteService,
  toggleServiceActive,
  listAllServices,
  updateServiceStatus,
} from "./service.controller.js";

const router = Router();

// Public: browse approved + active services
router.get("/", listServices);

// Vendor: own services (any status)
router.get("/mine", requireAuth, requireVendor, listMyServices);

// Admin: every service in the system (must be registered before /:id)
router.get("/admin/all", requireAuth, requireAdmin, listAllServices);

// Admin: approve or reject
router.patch("/admin/:id/status", requireAuth, requireAdmin, updateServiceStatus);

// Vendor: create a service (goes to pending for admin review)
router.post("/", requireAuth, requireVendor, createService);

// Public: single approved + active service
router.get("/:id", getServiceById);

// Vendor: update own service
router.patch("/:id", requireAuth, requireVendor, updateService);

// Vendor: activate / deactivate own service
router.patch("/:id/active", requireAuth, requireVendor, toggleServiceActive);

// Vendor (own) or admin (any): delete
router.delete("/:id", requireAuth, deleteService);

export default router;
