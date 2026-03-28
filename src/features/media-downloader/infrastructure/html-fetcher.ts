import { appConfig } from "@/server/config";
import { validateDnsResolution, validateUrlFormat } from "@/server/security";
import { Errors } from "../domain/errors";

const HTTP_ERROR_MESSAGES: Record<number, string> = {
  401: "Essa pagina exige login. O Grabix so acessa paginas publicas.",
  403: "Acesso negado pelo servidor. A pagina pode estar protegida ou bloqueando bots.",
  404: "Pagina nao encontrada. Verifica se a URL esta correta.",
  429: "O servidor limitou as requisicoes. Tenta de novo em alguns minutos.",
  500: "O servidor da pagina esta com erro interno. Tenta de novo mais tarde.",
  502: "O servidor da pagina esta fora do ar (Bad Gateway).",
  503: "O servidor da pagina esta indisponivel no momento. Tenta de novo depois.",
};

export async function fetchPageHtml(rawUrl: string): Promise<{
  html: string;
  resolvedUrl: string;
}> {
  if (!rawUrl?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  const url = await validateUrlFormat(rawUrl);
  await validateDnsResolution(url.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.limits.fetchTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Grabix/1.0 (media-downloader; +https://github.com/grabix)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Errors.fetchFailed("Timeout ao buscar página.");
    }
    throw Errors.fetchFailed("Erro de rede.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const reason = HTTP_ERROR_MESSAGES[response.status] ?? `A pagina retornou status ${response.status}.`;
    throw Errors.fetchFailed(reason);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("text/html")) {
    throw Errors.notHtml();
  }

  const contentLengthRaw = response.headers.get("content-length");
  if (contentLengthRaw) {
    const size = parseInt(contentLengthRaw, 10);
    if (!Number.isNaN(size) && size > appConfig.limits.maxHtmlSizeBytes) {
      throw Errors.htmlTooLarge();
    }
  }

  const html = await response.text();
  if (!html) {
    throw Errors.fetchFailed("HTML vazio recebido.");
  }

  if (html.length > appConfig.limits.maxHtmlSizeBytes) {
    throw Errors.htmlTooLarge();
  }

  return { html, resolvedUrl: response.url };
}
