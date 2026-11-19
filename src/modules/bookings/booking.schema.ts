
import { z } from "zod";

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),

  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Event date is required")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, {
      message: "Event date must be a valid date",
    })
    .refine((value) => new Date(`${value}T00:00:00.000Z`).getTime() > Date.now(), {
      message: "Event date must be in the future",
    }),

  eventLocation: z
    .string()
    .trim()
    .min(2, "Event location is required")
    .max(200, "Event location is too long"),

  message: z.string().trim().max(1000, "Message is too long").optional(),
});

export const bookingStatusSchema = z.object({
  status: z.enum(["accepted", "rejected", "cancelled"], {
    message: "Status must be accepted, rejected, or cancelled",
  }),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
