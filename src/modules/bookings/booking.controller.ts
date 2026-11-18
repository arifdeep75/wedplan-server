
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../../config/db.js";
import { COLLECTIONS } from "../../config/collections.js";
import { createBookingSchema, bookingStatusSchema } from "./booking.schema.js";
import type { AuthUser } from "../../middleware/auth.middleware.js";

interface ServiceDocument {
  _id: unknown;
  vendorId: string;
  serviceName: string;
  price: number;
  status?: string;
  isActive?: boolean;
}

interface BookingDocument {
  _id: unknown;
  serviceId: string;
  customerId: string;
  vendorId: string;
  serviceName: string;
  price: number;
  eventDate: Date;
  message?: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function bookings() {
  return getDB().collection(COLLECTIONS.BOOKINGS);
}

function services() {
  return getDB().collection(COLLECTIONS.SERVICES);
}

function toObjectId(id: string): ObjectId | null {
  try {
    return ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id)
      ? new ObjectId(id)
      : null;
  } catch {
    return null;
  }
}

function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

/* ------------------------------------------------------------------ */
/* Customer endpoints                                                  */
/* ------------------------------------------------------------------ */

// Customer books a service. The vendor is derived from the service on the
// server — client-sent vendorId/status are never trusted.
export async function createBooking(req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const parsed = createBookingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || "Invalid booking details",
      });
    }

    const serviceId = toObjectId(parsed.data.serviceId);

    if (!serviceId) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const service = (await services().findOne({
      _id: serviceId,
      status: "approved",
      isActive: true,
    })) as unknown as ServiceDocument | null;

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found or not available for booking",
      });
    }

    // A vendor cannot book their own service
    if (String(service.vendorId) === user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot book your own service",
      });
    }

    // Prevent duplicate active bookings for the same service + date
    const eventDate = new Date(parsed.data.eventDate);
    const startOfDay = new Date(eventDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(eventDate);
    endOfDay.setHours(23, 59, 59, 999);

    const duplicate = await bookings().findOne({
      customerId: user.id,
      serviceId: String(service._id),
      eventDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ["pending", "accepted"] },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "You already have a booking for this service on that date",
      });
    }

    const now = new Date();

    const result = await bookings().insertOne({
      serviceId: String(service._id),
      customerId: user.id, // server-derived
      vendorId: String(service.vendorId), // server-derived
      serviceName: service.serviceName, // snapshot at booking time
      price: service.price, // snapshot at booking time
      eventDate,
      message: parsed.data.message ?? "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      message: "Booking request sent to the vendor",
      data: { id: String(result.insertedId) },
    });
  } catch (error) {
    console.error("Create booking error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create booking",
    });
  }
}

// Customer lists their own bookings (with service + vendor info).
export async function listMyBookings(_req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const found = (await bookings()
      .find({ customerId: user.id })
      .sort({ createdAt: -1 })
      .toArray()) as unknown as BookingDocument[];

    const data = await withServiceInfo(found);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("List my bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your bookings",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Vendor endpoints                                                    */
/* ------------------------------------------------------------------ */

// Vendor lists bookings for their services only.
export async function listVendorBookings(_req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const found = (await bookings()
      .find({ vendorId: user.id })
      .sort({ createdAt: -1 })
      .toArray()) as unknown as BookingDocument[];

    const data = await withCustomerInfo(found);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("List vendor bookings error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load bookings",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Shared status update (owner checks per role)                        */
/* ------------------------------------------------------------------ */

// Vendor accepts/rejects bookings for their services.
// Customer cancels their own pending/accepted bookings.
export async function updateBookingStatus(req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const id = toObjectId(String(req.params.id ?? ""));

    if (!id) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const parsed = bookingStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || "Invalid status",
      });
    }

    const booking = (await bookings().findOne({ _id: id })) as unknown as
      | BookingDocument
      | null;

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const nextStatus = parsed.data.status;
    const isVendor = user.role === "vendor" && String(booking.vendorId) === user.id;
    const isCustomer = user.role === "customer" && String(booking.customerId) === user.id;

    if (!isVendor && !isCustomer) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this booking",
      });
    }

    // Role-specific transition rules
    if (isVendor) {
      if (booking.status !== "pending") {
        return res.status(409).json({
          success: false,
          message: `This booking is already ${booking.status}`,
        });
      }

      if (nextStatus !== "accepted" && nextStatus !== "rejected") {
        return res.status(403).json({
          success: false,
          message: "Vendors can only accept or reject bookings",
        });
      }
    }

    if (isCustomer) {
      if (
        (booking.status !== "pending" && booking.status !== "accepted") ||
        nextStatus !== "cancelled"
      ) {
        return res.status(403).json({
          success: false,
          message: "You can only cancel your own pending or accepted bookings",
        });
      }
    }

    await bookings().updateOne(
      { _id: id },
      { $set: { status: nextStatus, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `Booking ${nextStatus} successfully`,
    });
  } catch (error) {
    console.error("Update booking status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update booking",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Customer-side enrichment: vendor business name + service image.
async function withServiceInfo(docs: BookingDocument[]) {
  const ids = [...new Set(docs.map((b) => String(b.serviceId)))]
    .map((id) => toObjectId(id))
    .filter((id): id is ObjectId => id !== null);

  const servicesFound = ids.length
    ? (await services()
        .find(
          { _id: { $in: ids } },
          { projection: { images: 1, vendorId: 1 } }
        )
        .toArray()) as unknown as Array<{ _id: unknown; images?: string[]; vendorId: string }>
    : [];

  const serviceMap = new Map(servicesFound.map((s) => [String(s._id), s]));

  return docs.map((booking) => {
    const service = serviceMap.get(String(booking.serviceId));

    return {
      id: String(booking._id),
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      price: booking.price,
      eventDate: booking.eventDate,
      message: booking.message ?? null,
      status: booking.status,
      image: service?.images?.[0] ?? null,
      createdAt: booking.createdAt ?? null,
    };
  });
}

// Vendor-side enrichment: customer name/email/image.
async function withCustomerInfo(docs: BookingDocument[]) {
  const ids = [...new Set(docs.map((b) => String(b.customerId)))]
    .map((id) => toObjectId(id))
    .filter((id): id is ObjectId => id !== null);

  const customers = ids.length
    ? (await getDB()
        .collection("user")
        .find(
          { _id: { $in: ids } },
          { projection: { name: 1, email: 1, image: 1 } }
        )
        .toArray()) as unknown as Array<{
      _id: unknown;
      name?: string;
      email?: string;
      image?: string | null;
    }>
    : [];

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));

  return docs.map((booking) => {
    const customer = customerMap.get(String(booking.customerId));

    return {
      id: String(booking._id),
      serviceName: booking.serviceName,
      price: booking.price,
      eventDate: booking.eventDate,
      message: booking.message ?? null,
      status: booking.status,
      customer: {
        id: booking.customerId,
        name: customer?.name ?? "WedPlan Customer",
        email: customer?.email ?? null,
        image: customer?.image ?? null,
      },
      createdAt: booking.createdAt ?? null,
    };
  });
}
