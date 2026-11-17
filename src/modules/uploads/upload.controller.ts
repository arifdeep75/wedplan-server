
import type { Request, Response } from "express";
import { uploadImageSchema } from "./upload.schema.js";

const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

interface ImgbbResponse {
  success?: boolean;
  status?: number;
  data?: {
    url?: string;
  };
  error?: {
    message?: string;
  };
}

export async function uploadImage(req: Request, res: Response) {
  try {
    if (!process.env.IMGBB_API_KEY) {
      console.error("IMGBB_API_KEY is missing from environment variables");

      return res.status(503).json({
        success: false,
        message: "Image upload is not configured on the server",
      });
    }

    const validation = uploadImageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.issues[0]?.message || "Invalid image",
      });
    }

    const { image, fileName } = validation.data;

    const { mimeType, payload: base64Payload } = splitDataUri(image);
    const buffer = Buffer.from(base64Payload, "base64");

    if (buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Image could not be decoded",
      });
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        success: false,
        message: "Image must be smaller than 5 MB",
      });
    }

    const formData = new FormData();
    formData.append("key", process.env.IMGBB_API_KEY);
    formData.append(
      "image",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      fileName || "profile-image"
    );

    const imgbbResponse = await fetch(IMGBB_UPLOAD_URL, {
      method: "POST",
      body: formData,
    });

    const result = (await imgbbResponse.json().catch(() => null)) as
      | ImgbbResponse
      | null;

    if (!imgbbResponse.ok || !result?.data?.url) {
      console.error(
        "ImgBB upload failed:",
        imgbbResponse.status,
        result?.error?.message
      );

      return res.status(502).json({
        success: false,
        message: "Failed to upload image. Please try again.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        url: result.data.url,
      },
    });
  } catch (error) {
    console.error("Image upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while uploading the image",
    });
  }
}

function splitDataUri(dataUri: string): {
  mimeType: string;
  payload: string;
} {
  const match = dataUri.match(/^data:([^;]+);base64,(.*)$/s);

  if (!match) {
    return { mimeType: "image/jpeg", payload: dataUri };
  }

  return { mimeType: match[1], payload: match[2] };
}
