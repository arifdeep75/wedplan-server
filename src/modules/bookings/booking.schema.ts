
import { z } from "zod";

export const createBookingSchema = z.object({
  serviceId: z.string().min(1, "Service is required"),

  eventDate: z
    .string()
    .min(1, "Event date is required")
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Event date must be a valid date",
    })
    .refine((value) => new Date(value).getTime() > Date.now(), {
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
