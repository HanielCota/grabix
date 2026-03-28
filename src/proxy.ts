import { type NextRequest, NextResponse } from "next/server";

// ─── Rate limiter (in-memory, per IP) ───

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateBucket>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const CLEANUP_INTERVAL = 5 * 60_000;

let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of rateLimits) {
    if (now > bucket.resetAt) rateLimits.delete(key);
  }
}

function isRateLimited(ip: string): { limited: boolean; remaining: number; resetAt: number } {
  cleanup();
  const now = Date.now();
  const bucket = rateLimits.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }

  bucket.count++;
  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  return { limited: bucket.count > MAX_REQUESTS, remaining, resetAt: bucket.resetAt };
}

// ─── Allowed methods per route ───

const API_METHODS: Record<string, string> = {
  "/api/analyze": "POST",
  "/api/download": "GET",
  "/api/download-zip": "POST",
};

// ─── Proxy ───

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Block unexpected HTTP methods
  const allowedMethod = API_METHODS[pathname];
  if (allowedMethod && request.method !== allowedMethod && request.method !== "OPTIONS") {
    return NextResponse.json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Metodo nao permitido." } },
      { status: 405, headers: { Allow: allowedMethod } },
    );
  }

  // Rate limiting
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

  const { limited, remaining, resetAt } = isRateLimited(ip);

  if (limited) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Muitas requisicoes. Tenta de novo em breve." } },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const response = NextResponse.next();

  // Rate limit headers
  response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
  response.headers.set("X-RateLimit-Remaining", String(remaining));

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
