
import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name is too long"),

  image: z
    .string()
    .trim()
    .url("Image must be a valid URL")
    .max(500, "Image URL is too long")
    .nullable()
    .optional(),

  businessName: z
    .string()
    .trim()
    .max(120, "Business name is too long")
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
