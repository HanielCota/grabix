const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::$/,
  /^::1$/i,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  // IPv4-mapped IPv6 in decimal form (e.g. ::ffff:127.0.0.1)
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/i,
  // IPv4-mapped IPv6 in hex form as normalized by WHATWG URL parser
  // (e.g. ::ffff:7f00:1 for 127.0.0.1)
  /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/i, // 127.0.0.0/8
  /^::ffff:a[0-9a-f]{2}:[0-9a-f]{1,4}$/i, // 10.0.0.0/8
  /^::ffff:ac1[0-9a-f]:[0-9a-f]{1,4}$/i, // 172.16.0.0/12
  /^::ffff:c0a8:[0-9a-f]{1,4}$/i, // 192.168.0.0/16
  /^::ffff:a9fe:[0-9a-f]{1,4}$/i, // 169.254.0.0/16
  /^::ffff:0{0,3}[0-9a-f]{0,2}:[0-9a-f]{1,4}$/i, // 0.0.0.0/8
  /^::ffff:64[4-7][0-9a-f]:[0-9a-f]{1,4}$/i, // 100.64.0.0/10
];

const HAS_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const IPV4_LITERAL_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_LITERAL_PATTERN = /:/;

export const MAX_PUBLIC_URL_LENGTH = 2048;

export function normalizeHttpUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return HAS_SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isPrivateHostname(hostname: string): boolean {
  let normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  // URL.hostname wraps IPv6 addresses in brackets — strip them for matching
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isIpLiteral(hostname: string): boolean {
  return IPV4_LITERAL_PATTERN.test(hostname) || IPV6_LITERAL_PATTERN.test(hostname);
}

export function getPublicUrlError(raw: string): string | null {
  const normalized = normalizeHttpUrlInput(raw);
  if (!normalized) {
    return "URL não pode ser vazia.";
  }

  if (normalized.length > MAX_PUBLIC_URL_LENGTH) {
    return `URL ultrapassa ${MAX_PUBLIC_URL_LENGTH} caracteres.`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return "URL inválida.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Apenas HTTP e HTTPS são permitidos.";
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    return "URL sem hostname.";
  }

  if (isPrivateHostname(hostname)) {
    return "URL aponta para endereço restrito.";
  }

  if (!hostname.includes(".") && !isIpLiteral(hostname)) {
    return "URL precisa ter um domínio válido.";
  }

  return null;
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
