export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

// ─── Error factories ───

export const Errors = {
  invalidUrl: (detail?: string) => new AppError(detail ?? "URL inválida.", "INVALID_URL"),

  ssrfBlocked: () => new AppError("URL aponta para endereço restrito.", "SSRF_BLOCKED", 403),

  fetchFailed: (reason: string) => new AppError(`Erro ao buscar: ${reason}`, "FETCH_FAILED", 502),

  notHtml: () => new AppError("Resposta não é HTML.", "NOT_HTML"),

  htmlTooLarge: () => new AppError("HTML ultrapassa limite de tamanho.", "HTML_TOO_LARGE"),

  tooManyAssets: () => new AppError("Número de arquivos ultrapassa limite.", "TOO_MANY_ASSETS"),

  fileTooLarge: () => new AppError("Arquivo ultrapassa limite de tamanho.", "FILE_TOO_LARGE"),

  zipTooLarge: () => new AppError("ZIP ultrapassa limite de tamanho.", "ZIP_TOO_LARGE"),

  downloadFailed: (reason: string) => new AppError(`Erro no download: ${reason}`, "DOWNLOAD_FAILED", 502),

  invalidMediaType: () => new AppError("Tipo de mídia inválido.", "INVALID_MEDIA_TYPE"),
} as const;
