import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/features/media-downloader/domain/errors";

export async function handleApiError(err: unknown): Promise<NextResponse> {
  if (err instanceof AppError) {
    return NextResponse.json(err.toJSON(), { status: err.statusCode });
  }

  if (err instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Corpo da requisição não é JSON válido.",
        },
      },
      { status: 400 },
    );
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: err.issues,
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno do servidor.",
      },
    },
    { status: 500 },
  );
}
