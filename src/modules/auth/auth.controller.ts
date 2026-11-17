
import type { Request, Response } from "express";
import { registerSchema } from "./auth.schema.js";
import { createAuth } from "../../lib/auth.js";

export async function registerUser(req: Request, res: Response) {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid registration information",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { name, email, password, role, image } = validation.data;

    const auth = createAuth();

    const result = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
        image,
        role,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: result,
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(400).json({
      success: false,
      message: "Registration failed. The email may already be registered.",
    });
  }
}
