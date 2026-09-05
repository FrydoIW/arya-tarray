import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { HttpError, SanitizedInternalError } from "../lib/http.js";

export type SafeErrorDiagnostic = {
  context: string;
  errorType: string;
  code?: string;
  stackFrames?: string;
};

export function safeErrorDiagnostic(error: unknown, context: string): SafeErrorDiagnostic {
  if (!(error instanceof Error)) return { context, errorType: typeof error };
  const code = "code" in error && typeof error.code === "string" && /^[A-Z0-9_-]{1,40}$/.test(error.code)
    ? error.code
    : undefined;
  // Omit the first stack line because database clients may embed rendered query
  // arguments (including PII) in the error message. Frames retain useful location data.
  const stackFrames = process.env.NODE_ENV !== "production"
    ? error.stack?.split("\n").filter(line => line.trimStart().startsWith("at ")).join("\n")
    : undefined;
  return { context, errorType: error.name || "Error", ...(code ? { code } : {}), ...(stackFrames ? { stackFrames } : {}) };
}

function logUnexpectedError(error: unknown, context: string) {
  console.error("Unexpected backend error", safeErrorDiagnostic(error, context));
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof SanitizedInternalError) {
    logUnexpectedError(error.originalError, error.context);
    res.status(500).json({ message: error.message });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      message: "Validation failed",
      issues: error.flatten()
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({ message: error.message });
    return;
  }

  logUnexpectedError(error, `${req.method} ${req.baseUrl || "request"}`);
  res.status(500).json({ message: "Unexpected server error" });
};
