
import { Router } from "express";
import { requireAuth, requireVendor, requireCustomer } from "../../middleware/auth.middleware.js";
import {
  createBooking,
  listMyBookings,
  listVendorBookings,
  updateBookingStatus,
} from "./booking.controller.js";

const router = Router();

// Customer: create a booking request
router.post("/", requireAuth, requireCustomer, createBooking);

// Customer: own bookings
router.get("/mine", requireAuth, requireCustomer, listMyBookings);

// Vendor: bookings for own services
router.get("/vendor", requireAuth, requireVendor, listVendorBookings);

// Vendor: accept/reject — Customer: cancel own
router.patch("/:id/status", requireAuth, updateBookingStatus);

export default router;
