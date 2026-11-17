
import { z } from "zod";

export const uploadImageSchema = z.object({
  // The client sends the selected file as a base64 data URI, e.g.
  // "data:image/png;base64,..."
  image: z
    .string()
    .min(1, "Image is required")
    .regex(
      /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/,
      "Image must be a base64-encoded PNG, JPEG, WEBP or GIF"
    ),

  fileName: z.string().trim().min(1).max(120).optional(),
});

export type UploadImageInput = z.infer<typeof uploadImageSchema>;
