import type { CheerioAPI } from "cheerio";
import { isVideoPlatformUrl } from "./platform-registry";
import type { LinkCandidate, LinkCategory } from "./types";
import { isFilteredUrl, isSameDomain, isSubdomain, normalizeUrl, resolveUrl } from "./url-utils";

const MEDIA_KEYWORDS =
  /\b(video|vídeo|watch|assistir|galeria|gallery|mídia|media|fotos|photos|episode|ep\.|clip|playlist|canal|channel)\b/i;

const SHARE_DOMAINS = new Set([
  "facebook.com",
  "twitter.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "tumblr.com",
  "whatsapp.com",
  "t.me",
]);

const SHARE_PATH_PATTERNS = [
  /facebook\.com\/sharer/,
  /twitter\.com\/intent/,
  /linkedin\.com\/sharing/,
  /pinterest\.com\/pin\/create/,
];

const LEGAL_TEXT_PATTERNS =
  /\b(terms|privacy|cookie|legal|termos|privacidade|política|imprint|disclaimer|conditions|gdpr|lgpd)\b/i;

const SHARE_CLASS_PATTERN = /\b(share|social|sharing)\b/i;

/**
 * Discover and classify links from a parsed HTML document.
 */
export function discoverLinks($: CheerioAPI, baseUrl: string): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;

    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) return;

    // Filter out irrelevant URLs
    if (isFilteredUrl(resolved)) return;

    // Deduplicate by normalized URL
    const normalized = normalizeUrl(resolved);
    if (seen.has(normalized)) return;
    seen.add(normalized);

    // Skip share links
    if (isShareLink(resolved, $el)) return;

    // Skip legal/privacy links
    const anchorText = $el.text().trim().slice(0, 200);
    if (LEGAL_TEXT_PATTERNS.test(anchorText)) return;

    // Classify
    const category = classifyLink(resolved, baseUrl);
    const isNavigation = isInSecondaryRegion($el);
    const context = getContext($el, $);
    const priority = calculatePriority(category, context, isNavigation);

    candidates.push({
      url: resolved,
      category,
      anchorText,
      context,
      isNavigation,
      priority,
    });
  });

  // Sort by priority (lower = higher priority)
  candidates.sort((a, b) => a.priority - b.priority);

  return candidates;
}

function classifyLink(url: string, baseUrl: string): LinkCategory {
  if (isVideoPlatformUrl(url)) return "video_platform";
  if (isSameDomain(url, baseUrl)) return "same_domain";
  if (isSubdomain(url, baseUrl)) return "subdomain";
  return "external";
}

function isShareLink(url: string, $el: ReturnType<CheerioAPI>): boolean {
  // Check URL against share domains
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (SHARE_DOMAINS.has(host)) return true;
  } catch {
    /* skip */
  }

  // Check URL path patterns
  for (const pattern of SHARE_PATH_PATTERNS) {
    if (pattern.test(url)) return true;
  }

  // Check element classes
  const className = $el.attr("class") ?? "";
  if (SHARE_CLASS_PATTERN.test(className)) return true;

  return false;
}

// Only match patterns that are unambiguously non-content regions.
// Avoid "related", "trending", "widget", "popular" — these are often main content.
const AD_REGION_CLASS_PATTERN = /\b(ad-container|ads-|advert|sponsor|banner-ad)\b/i;

function isInSecondaryRegion($el: ReturnType<CheerioAPI>): boolean {
  // Only structural navigation elements — NOT <aside> (often contains real content)
  if ($el.parents("nav, header, footer").length > 0) return true;

  // Check parent chain for ad containers or navigation roles
  let current = $el.parent();
  for (let i = 0; i < 8 && current.length > 0; i++) {
    const className = current.attr("class") ?? "";
    const id = current.attr("id") ?? "";
    const role = current.attr("role") ?? "";
    if (AD_REGION_CLASS_PATTERN.test(className) || AD_REGION_CLASS_PATTERN.test(id) || role === "navigation") {
      return true;
    }
    current = current.parent();
  }

  return false;
}

function getContext($el: ReturnType<CheerioAPI>, _$: CheerioAPI): string {
  // Get text from the link and its parent for context
  const linkText = $el.text().trim();
  const parentText = $el.parent().text().trim();
  return `${linkText} ${parentText}`.slice(0, 300);
}

function calculatePriority(category: LinkCategory, context: string, isNavigation: boolean): number {
  if (category === "video_platform") return 1;
  if (category === "same_domain" && MEDIA_KEYWORDS.test(context)) return 2;
  if ((category === "same_domain" || category === "subdomain") && !isNavigation) return 3;
  if (isNavigation) return 4;
  return 5; // external
}
