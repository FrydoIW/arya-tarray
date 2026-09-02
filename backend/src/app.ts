import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.js";
import { requireAuth } from "./middleware/auth.js";
import { requireActiveUser } from "./middleware/authorization.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { apiRouter } from "./routes/api.routes.js";

export const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "arya-tarray-backend" });
});

app.use("/api/auth", authRouter);
app.use("/api", requireAuth, requireActiveUser, apiRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use(errorHandler);
