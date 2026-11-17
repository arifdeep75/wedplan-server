
import { Router } from "express";
import { uploadImage } from "./upload.controller.js";

const router = Router();

router.post("/image", uploadImage);

export default router;
