import { lookup } from "node:dns/promises";
import { AppError, Errors } from "@/features/media-downloader/domain/errors";
import { isPrivateHostname, normalizeHttpUrlInput } from "@/lib/url/public-url";

// ─── DNS cache ───

const dnsCache = new Map<string, { addresses: string[]; timestamp: number }>();
const DNS_CACHE_TTL = 5 * 60 * 1000;
const DNS_CACHE_MAX = 500;
const DNS_TIMEOUT = 5000;

function isPrivateIp(ip: string): boolean {
  return isPrivateHostname(ip);
}

// ─── URL validation ───

export async function validateUrlFormat(raw: string): Promise<URL> {
  const normalized = normalizeHttpUrlInput(raw);
  if (!normalized) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw Errors.invalidUrl("URL malformada.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Errors.invalidUrl("Apenas HTTP e HTTPS são permitidos.");
  }

  const hostname = url.hostname?.toLowerCase();
  if (!hostname) {
    throw Errors.invalidUrl("URL sem hostname.");
  }

  if (isPrivateHostname(hostname)) {
    throw Errors.ssrfBlocked();
  }

  return url;
}

// ─── DNS resolution ───

export async function validateDnsResolution(hostname: string): Promise<void> {
  if (!hostname) {
    throw Errors.invalidUrl("Hostname vazio.");
  }

  const cached = dnsCache.get(hostname);
  const now = Date.now();

  if (cached && now - cached.timestamp < DNS_CACHE_TTL) {
    if (cached.addresses.some((address) => isPrivateIp(address))) {
      throw Errors.ssrfBlocked();
    }
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT);
    });

    const results = (await Promise.race([lookup(hostname, { all: true, verbatim: true }), timeoutPromise])) as Array<{
      address: string;
    }>;

    const addresses = Array.from(new Set(results.map((result) => result.address).filter(Boolean)));

    if (addresses.length === 0) {
      throw Errors.fetchFailed(`DNS não retornou endereço para ${hostname}`);
    }

    // Evict oldest entry if cache is full
    if (dnsCache.size >= DNS_CACHE_MAX) {
      const oldest = dnsCache.keys().next().value;
      if (oldest !== undefined) dnsCache.delete(oldest);
    }
    dnsCache.set(hostname, { addresses, timestamp: now });

    if (addresses.some((address) => isPrivateIp(address))) {
      throw Errors.ssrfBlocked();
    }
  } catch (err) {
    dnsCache.delete(hostname);
    if (err instanceof AppError) throw err;

    if (err instanceof Error && err.message === "DNS timeout") {
      throw Errors.fetchFailed(`Timeout DNS para ${hostname}`);
    }

    throw Errors.fetchFailed(`Falha na resolução DNS de ${hostname}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
