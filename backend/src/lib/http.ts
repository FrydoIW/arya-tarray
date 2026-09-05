import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export class SanitizedInternalError extends HttpError {
  constructor(
    message: string,
    public readonly context: string,
    public readonly originalError: unknown
  ) {
    super(500, message);
    this.name = "SanitizedInternalError";
  }
}

export function privateErrorHandler(context: string, publicMessage: string): ErrorRequestHandler {
  return (error, _req, _res, next) => {
    next(error instanceof HttpError || error instanceof ZodError
      ? error
      : new SanitizedInternalError(publicMessage, context, error));
  };
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
