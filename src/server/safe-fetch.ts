import { Errors } from "@/features/media-downloader/domain/errors";
import { validateDnsResolution, validateUrlFormat } from "./security";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

interface SafeFetchOptions extends Omit<RequestInit, "redirect" | "signal"> {
  timeoutMs: number;
  signal?: AbortSignal;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  response: Response;
  resolvedUrl: string;
}

function createFetchSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const { timeoutMs, signal, maxRedirects = 5, headers, ...init } = options;
  let currentUrl = await validateUrlFormat(typeof input === "string" ? input : input.toString());

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validateDnsResolution(currentUrl.hostname);

    const response = await fetch(currentUrl.toString(), {
      ...init,
      headers,
      redirect: "manual",
      signal: createFetchSignal(timeoutMs, signal),
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return { response, resolvedUrl: currentUrl.toString() };
    }

    if (redirectCount === maxRedirects) {
      throw Errors.fetchFailed("Muitos redirecionamentos.");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw Errors.fetchFailed("Redirecionamento sem destino.");
    }

    currentUrl = await validateUrlFormat(new URL(location, currentUrl).toString());
  }

  throw Errors.fetchFailed("Falha ao seguir redirecionamento.");
}
