
import { z } from "zod";

export const blockUserSchema = z.object({
  isBlocked: z.boolean({ message: "isBlocked must be true or false" }),
});

export type BlockUserInput = z.infer<typeof blockUserSchema>;
