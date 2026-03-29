import type { CheerioAPI } from "cheerio";
import { isVideoPlatformUrl } from "./platform-registry";
import type { LinkCandidate, LinkCategory, LinkSource } from "./types";
import { isFilteredUrl, isSameDomain, isSubdomain, normalizeUrl, resolveUrl } from "./url-utils";

const HUB_KEYWORDS =
  /\b(video|videos|vídeo|vídeos|watch|assistir|play|reproduzir|media|mídia|conteudo|conteúdo|aula|aulas|curso|modulo|módulo|portal|biblioteca|playlist|clip|clips|live|lives|stream|livestream|webinar|aovivo|ao vivo|arquivo|acervo|members|member|holodex|youtube|vturb|vsl|estudo de caso|depoimento|配信|切り抜き|アーカイブ|歌ってみた)\b/i;

const CTA_KEYWORDS = /\b(acessar|entrar|ver agora|abrir|continuar|começar|comecar|assistir agora|saiba mais)\b/i;

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
  /facebook\.com\/sharer/i,
  /twitter\.com\/intent/i,
  /linkedin\.com\/sharing/i,
  /pinterest\.com\/pin\/create/i,
];

const LEGAL_TEXT_PATTERNS =
  /\b(terms|privacy|cookie|legal|termos|privacidade|política|imprint|disclaimer|conditions|gdpr|lgpd)\b/i;

const SHARE_CLASS_PATTERN = /\b(share|social|sharing)\b/i;
const BUTTON_SELECTOR =
  "button, [role='button'], [data-href], [data-url], [data-link], [data-link-url], [data-target-url], [formaction]";
const DATA_URL_ATTRS = [
  "data-href",
  "data-url",
  "data-link",
  "data-link-url",
  "data-target-url",
  "formaction",
] as const;
const ONCLICK_URL_PATTERNS = [
  /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"'#]+)["']/gi,
  /location\.assign\(\s*["']([^"'#]+)["']\s*\)/gi,
  /window\.open\(\s*["']([^"'#]+)["']/gi,
  /router\.push\(\s*["']([^"'#]+)["']\s*\)/gi,
  /navigate\(\s*["']([^"'#]+)["']\s*\)/gi,
];

const SETTINGS_URL_KEY_PATTERN =
  /(?:^|\.)(?:url|href|link|target|target_url|link_url|youtube_url|vimeo_url|external_url|watch_url|embed_url|video_url|hosted_url)$/i;

type CheerioElement = ReturnType<CheerioAPI>;

interface RawCandidate {
  url: string;
  anchorText: string;
  context: string;
  isNavigation: boolean;
  source: LinkSource;
  interactive: boolean;
  discoveredFrom: string;
  discoveryReason: string | null;
}

export function discoverLinks($: CheerioAPI, baseUrl: string): LinkCandidate[] {
  const byUrl = new Map<string, LinkCandidate>();

  const addCandidate = (candidate: RawCandidate) => {
    const resolved = resolveUrl(candidate.url, baseUrl);
    if (!resolved || isFilteredUrl(resolved)) return;
    if (isShareLink(resolved, candidate.context)) return;
    if (LEGAL_TEXT_PATTERNS.test(candidate.anchorText)) return;

    const normalized = normalizeUrl(resolved);
    const category = classifyLink(resolved, baseUrl);
    const priority = calculatePriority(category, candidate.context, candidate.isNavigation, candidate.source);
    const next: LinkCandidate = {
      ...candidate,
      url: resolved,
      category,
      priority,
    };

    const existing = byUrl.get(normalized);
    if (!existing || shouldReplace(existing, next)) {
      byUrl.set(normalized, next);
    }
  };

  collectAnchorCandidates($, baseUrl, addCandidate);
  collectButtonCandidates($, baseUrl, addCandidate);
  collectOnClickCandidates($, baseUrl, addCandidate);
  collectDataSettingsCandidates($, baseUrl, addCandidate);

  return Array.from(byUrl.values()).sort((a, b) => a.priority - b.priority);
}

function collectAnchorCandidates($: CheerioAPI, baseUrl: string, add: (candidate: RawCandidate) => void) {
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;

    add({
      url: href,
      anchorText: getElementLabel($el),
      context: getContext($el),
      isNavigation: isInSecondaryRegion($el),
      source: "anchor",
      interactive: false,
      discoveredFrom: baseUrl,
      discoveryReason: inferDiscoveryReason(href, getContext($el), "anchor"),
    });
  });
}

function collectButtonCandidates($: CheerioAPI, baseUrl: string, add: (candidate: RawCandidate) => void) {
  $(BUTTON_SELECTOR).each((_, el) => {
    const $el = $(el);

    for (const attr of DATA_URL_ATTRS) {
      const value = $el.attr(attr);
      if (!value) continue;

      add({
        url: value,
        anchorText: getElementLabel($el),
        context: getContext($el),
        isNavigation: isInSecondaryRegion($el),
        source: $el.is("button, [role='button']") ? "button" : "data_attr",
        interactive: true,
        discoveredFrom: baseUrl,
        discoveryReason: "interactive-destination",
      });
    }
  });
}

function collectOnClickCandidates($: CheerioAPI, baseUrl: string, add: (candidate: RawCandidate) => void) {
  $("[onclick]").each((_, el) => {
    const $el = $(el);
    const onclick = $el.attr("onclick");
    if (!onclick || onclick.length > 4000) return;

    for (const pattern of ONCLICK_URL_PATTERNS) {
      for (const match of onclick.matchAll(pattern)) {
        const target = match[1]?.trim();
        if (!target) continue;

        add({
          url: target,
          anchorText: getElementLabel($el),
          context: getContext($el),
          isNavigation: isInSecondaryRegion($el),
          source: "onclick",
          interactive: true,
          discoveredFrom: baseUrl,
          discoveryReason: "onclick-navigation",
        });
      }
    }
  });
}

function collectDataSettingsCandidates($: CheerioAPI, baseUrl: string, add: (candidate: RawCandidate) => void) {
  $("[data-settings]").each((_, el) => {
    const $el = $(el);
    const raw = $el.attr("data-settings");
    if (!raw || raw.length > 20_000) return;

    const entries = extractUrlsFromDataSettings(raw);
    if (entries.length === 0) return;

    for (const entry of entries) {
      add({
        url: entry.url,
        anchorText: getElementLabel($el),
        context: `${getContext($el)} ${entry.path}`.trim(),
        isNavigation: isInSecondaryRegion($el),
        source: "data_settings",
        interactive: true,
        discoveredFrom: baseUrl,
        discoveryReason: inferSettingsReason(entry.path),
      });
    }
  });
}

function classifyLink(url: string, baseUrl: string): LinkCategory {
  if (isVideoPlatformUrl(url)) return "video_platform";
  if (isSameDomain(url, baseUrl)) return "same_domain";
  if (isSubdomain(url, baseUrl)) return "subdomain";
  return "external";
}

function shouldReplace(current: LinkCandidate, next: LinkCandidate): boolean {
  if (next.priority !== current.priority) {
    return next.priority < current.priority;
  }

  if (next.interactive !== current.interactive) {
    return next.interactive;
  }

  return next.context.length > current.context.length;
}

function isShareLink(url: string, context: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (SHARE_DOMAINS.has(host)) return true;
  } catch {
    return false;
  }

  if (SHARE_CLASS_PATTERN.test(context)) return true;
  return SHARE_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

const AD_REGION_CLASS_PATTERN = /\b(ad-container|ads-|advert|sponsor|banner-ad)\b/i;

function isInSecondaryRegion($el: CheerioElement): boolean {
  if ($el.parents("nav, header, footer").length > 0) return true;

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

function getElementLabel($el: CheerioElement): string {
  const text = $el.text().replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 200);

  const ariaLabel = $el.attr("aria-label")?.trim();
  if (ariaLabel) return ariaLabel.slice(0, 200);

  const title = $el.attr("title")?.trim();
  if (title) return title.slice(0, 200);

  const alt = $el.find("img[alt]").first().attr("alt")?.trim();
  if (alt) return alt.slice(0, 200);

  return "";
}

function getContext($el: CheerioElement): string {
  const parts = [
    getElementLabel($el),
    $el.attr("class") ?? "",
    $el.attr("data-widget_type") ?? "",
    $el.attr("data-element_type") ?? "",
    $el.parent().text().replace(/\s+/g, " ").trim(),
  ];

  return parts.filter(Boolean).join(" ").slice(0, 350);
}

function calculatePriority(category: LinkCategory, context: string, isNavigation: boolean, source: LinkSource): number {
  const hasHubKeywords = HUB_KEYWORDS.test(context);
  const hasCtaKeywords = CTA_KEYWORDS.test(context);
  const isInteractiveSource = source === "button" || source === "data_settings" || source === "onclick";

  if (category === "video_platform") {
    if (!isNavigation && (hasHubKeywords || isInteractiveSource)) return 1;
    return 2;
  }

  if (category === "same_domain" && hasHubKeywords) {
    return isInteractiveSource || hasCtaKeywords ? 1 : 2;
  }

  if ((category === "same_domain" || category === "subdomain") && isInteractiveSource && !isNavigation) {
    return 2;
  }

  if ((category === "same_domain" || category === "subdomain") && !isNavigation) {
    return 3;
  }

  if (category === "external" && hasHubKeywords) {
    return 4;
  }

  if (isNavigation) return 5;
  return 6;
}

function inferDiscoveryReason(url: string, context: string, source: LinkSource): string | null {
  if (isVideoPlatformUrl(url)) return "platform-reference";
  if (HUB_KEYWORDS.test(context)) return "content-hub";
  if (source === "onclick") return "onclick-navigation";
  if (source === "button" || source === "data_attr") return "interactive-destination";
  return null;
}

function inferSettingsReason(path: string): string {
  if (/youtube|vimeo|video|embed/i.test(path)) return "player-config";
  if (/link|url|href|target/i.test(path)) return "data-settings-link";
  return "data-settings";
}

function extractUrlsFromDataSettings(raw: string): Array<{ url: string; path: string }> {
  const decoded = decodeAttributeJson(raw);
  let data: unknown;

  try {
    data = JSON.parse(decoded);
  } catch {
    return [];
  }

  const results: Array<{ url: string; path: string }> = [];
  collectSettingUrls(data, results);
  return results;
}

function collectSettingUrls(value: unknown, results: Array<{ url: string; path: string }>, path = "", depth = 0) {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 500) return;

    if (SETTINGS_URL_KEY_PATTERN.test(path) && looksLikeNavigableUrl(trimmed)) {
      results.push({ url: trimmed, path });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectSettingUrls(value[i], results, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      collectSettingUrls(nested, results, nextPath, depth + 1);
    }
  }
}

function decodeAttributeJson(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function looksLikeNavigableUrl(value: string): boolean {
  if (value.startsWith("javascript:") || value.startsWith("data:") || value.startsWith("mailto:")) {
    return false;
  }

  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//") || value.startsWith("/");
}
