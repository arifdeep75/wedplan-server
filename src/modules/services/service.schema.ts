
import { z } from "zod";
import { SERVICE_CATEGORIES } from "../../constants/index.js";

export const createServiceSchema = z.object({
  serviceName: z
    .string()
    .trim()
    .min(3, "Service name must be at least 3 characters")
    .max(120, "Service name is too long"),

  category: z.enum(SERVICE_CATEGORIES, {
    message: "Please choose a valid service category",
  }),

  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description is too long")
    .optional(),

  price: z
    .number({ message: "Price is required" })
    .int("Price must be a whole number")
    .min(0, "Price cannot be negative")
    .max(100_000_000, "Price is too large"),

  location: z
    .string()
    .trim()
    .min(2, "Location is required")
    .max(120, "Location is too long"),

  images: z
    .array(z.url("Each image must be a valid URL"))
    .max(6, "Up to 6 images are allowed")
    .optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export const serviceStatusSchema = z.object({
  status: z.enum(["approved", "rejected"], {
    message: "Status must be approved or rejected",
  }),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
