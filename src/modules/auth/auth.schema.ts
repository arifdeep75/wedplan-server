
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[a-z]/, "Password must contain a lowercase letter");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),

  email: z.string().trim().email("Enter a valid email address"),

  password: passwordSchema,

  role: z.enum(["customer", "vendor"]).optional(),

  image: z.string().url().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
