const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
]);

const FILTERED_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".ico",
  ".xml",
  ".rss",
  ".atom",
  ".json",
  ".map",
  ".svg",
]);

const AUTH_PATH_SEGMENTS = new Set([
  "login",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "logout",
  "sign-out",
  "signout",
  "auth",
  "oauth",
  "sso",
  "forgot-password",
  "reset-password",
  "password",
]);

const PRIVATE_IP_PATTERNS = [
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
];

/**
 * Resolve a potentially relative URL against a base URL.
 * Returns null if the URL is invalid.
 */
export function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Normalize a URL: remove tracking params, trailing slash, force https.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);

    // Normalize protocol to https
    if (u.protocol === "http:") {
      u.protocol = "https:";
    }

    // Remove tracking params
    for (const param of TRACKING_PARAMS) {
      u.searchParams.delete(param);
    }

    // Remove hash
    u.hash = "";

    // Remove trailing slash (except for root path)
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Check if two URLs share the same domain (ignoring www prefix).
 */
export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const b = new URL(baseUrl).hostname.replace(/^www\./, "").toLowerCase();
    return a === b;
  } catch {
    return false;
  }
}

/**
 * Check if URL is a subdomain of the base URL's domain.
 */
export function isSubdomain(url: string, baseUrl: string): boolean {
  try {
    const urlHost = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "").toLowerCase();
    if (urlHost === baseHost) return false;
    return urlHost.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

/**
 * Check if a URL should be filtered out (anchors, mailto, assets, auth pages, etc.).
 */
export function isFilteredUrl(url: string): boolean {
  // Pure anchors and non-http protocols
  if (url === "#" || url.startsWith("#")) return true;
  if (url.startsWith("mailto:")) return true;
  if (url.startsWith("tel:")) return true;
  if (url.startsWith("javascript:")) return true;
  if (url.startsWith("data:")) return true;

  try {
    const u = new URL(url);

    // Non-HTTP protocols
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;

    // Static assets by extension
    const pathname = u.pathname.toLowerCase();
    for (const ext of FILTERED_EXTENSIONS) {
      if (pathname.endsWith(ext)) return true;
    }

    // Auth/login pages
    const segments = pathname.split("/").filter(Boolean);
    for (const segment of segments) {
      if (AUTH_PATH_SEGMENTS.has(segment.toLowerCase())) return true;
    }
  } catch {
    return true; // Invalid URLs are filtered
  }

  return false;
}

/**
 * Validate and sanitize a URL. Rejects non-HTTP protocols and private IPs.
 * Throws on invalid URL.
 */
export function sanitizeUrl(url: string): string {
  const u = new URL(url); // throws if invalid

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${u.protocol}`);
  }

  const hostname = u.hostname.toLowerCase();

  // Block localhost
  if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1") {
    throw new Error("Blocked: localhost");
  }

  // Block private IPs
  if (isPrivateIp(hostname)) {
    throw new Error("Blocked: private IP");
  }

  return u.toString();
}

/**
 * Check if a hostname or IP is in a private range.
 */
export function isPrivateIp(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
}
