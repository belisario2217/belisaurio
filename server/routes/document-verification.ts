import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifyDocument } from "../services/document-verification.js";

export const documentVerificationRouter = Router();
documentVerificationRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Se alcanzó el límite de consultas. Intenta de nuevo en unos minutos." } }));
documentVerificationRouter.get("/verify/:token", (req, res) => {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, noarchive" }).json(verifyDocument(String(req.params.token)));
});
