import { lookup } from "node:dns/promises";
import { AppError, Errors } from "@/features/media-downloader/domain/errors";

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.)/i,
];

// ─── DNS cache ───

const dnsCache = new Map<string, { address: string; timestamp: number }>();
const DNS_CACHE_TTL = 5 * 60 * 1000;
const DNS_CACHE_MAX = 500;
const DNS_TIMEOUT = 5000;

function isPrivateIp(ip: string): boolean {
  if (!ip) return true; // treat empty as private (block)
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

// ─── URL validation ───

export async function validateUrlFormat(raw: string): Promise<URL> {
  if (!raw?.trim()) {
    throw Errors.invalidUrl("URL não pode ser vazia.");
  }

  let url: URL;
  try {
    url = new URL(raw);
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

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
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
    if (isPrivateIp(cached.address)) {
      throw Errors.ssrfBlocked();
    }
    return;
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT);
    });

    const result = (await Promise.race([lookup(hostname), timeoutPromise])) as { address: string };

    if (!result?.address) {
      throw Errors.fetchFailed(`DNS não retornou endereço para ${hostname}`);
    }

    // Evict oldest entry if cache is full
    if (dnsCache.size >= DNS_CACHE_MAX) {
      const oldest = dnsCache.keys().next().value;
      if (oldest !== undefined) dnsCache.delete(oldest);
    }
    dnsCache.set(hostname, { address: result.address, timestamp: now });

    if (isPrivateIp(result.address)) {
      throw Errors.ssrfBlocked();
    }
  } catch (err) {
    dnsCache.delete(hostname);
    if (err instanceof AppError) throw err;

    if (err instanceof Error && err.message === "DNS timeout") {
      throw Errors.fetchFailed(`Timeout DNS para ${hostname}`);
    }

    throw Errors.fetchFailed(`Falha na resolução DNS de ${hostname}`);
  }
}
