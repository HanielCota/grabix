export const IMAGE_EXTENSION_LIST = ["jpg", "jpeg", "png", "webp", "gif", "svg"] as const;
export const VIDEO_EXTENSION_LIST = [
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogg",
  "avi",
  "mkv",
  "flv",
  "wmv",
  "3gp",
  "3g2",
  "ts",
  "f4v",
  "mpg",
  "mpeg",
  "asf",
  "m3u8",
  "mpd",
] as const;
export const ALL_MEDIA_EXTENSION_LIST = [...IMAGE_EXTENSION_LIST, ...VIDEO_EXTENSION_LIST] as const;

export type MediaExtension = (typeof ALL_MEDIA_EXTENSION_LIST)[number];

// ─── Lookup sets ───

const IMAGE_EXTENSIONS = new Set<string>(IMAGE_EXTENSION_LIST);
const VIDEO_EXTENSIONS = new Set<string>(VIDEO_EXTENSION_LIST);
const ALL_MEDIA_EXTENSIONS = new Set<string>(ALL_MEDIA_EXTENSION_LIST);

// ─── MIME → extension mapping ───

const MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogg",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/x-flv": "flv",
  "video/x-ms-wmv": "wmv",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "video/mp2t": "ts",
  "video/x-f4v": "f4v",
  "video/mpeg": "mpg",
  "video/x-ms-asf": "asf",
  "application/x-mpegurl": "m3u8",
  "application/vnd.apple.mpegurl": "m3u8",
  "application/dash+xml": "mpd",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const ALLOWED_MEDIA_CONTENT_TYPE_PATTERNS = [
  "image/",
  "video/",
  "application/octet-stream",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "application/dash+xml",
];

export function extensionFromMime(mime: string): string | null {
  const clean = mime.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[clean] ?? null;
}

export function isVideoMime(mime: string): boolean {
  return mime.split(";")[0].trim().toLowerCase().startsWith("video/");
}

export function isAllowedMediaContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return ALLOWED_MEDIA_CONTENT_TYPE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function getExtensionFromUrl(url: string): string | null {
  if (!url) return null;

  try {
    const pathname = new URL(url).pathname;
    if (!pathname || pathname === "/") return null;

    const lastSegment = pathname.split("/").pop();
    if (!lastSegment) return null;

    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
    if (!ext) return null;

    return ext;
  } catch {
    return null;
  }
}

export function isMediaExtension(ext: string): ext is MediaExtension {
  if (!ext) return false;
  return ALL_MEDIA_EXTENSIONS.has(ext.toLowerCase());
}

export function classifyByExtension(ext: string): "IMAGE" | "VIDEO" | null {
  if (!ext) return null;

  const lower = ext.toLowerCase();
  if (IMAGE_EXTENSIONS.has(lower)) return "IMAGE";
  if (VIDEO_EXTENSIONS.has(lower)) return "VIDEO";
  return null;
}

export function getFileNameFromUrl(url: string, index: number): string {
  if (!url) return `media-${index + 1}.bin`;

  try {
    const pathname = new URL(url).pathname;
    const basename = pathname?.split("/").pop();

    if (!basename?.includes(".")) {
      const ext = getExtensionFromUrl(url);
      return `media-${index + 1}.${ext ?? "bin"}`;
    }

    try {
      return decodeURIComponent(basename);
    } catch {
      return basename;
    }
  } catch {
    const ext = getExtensionFromUrl(url);
    return `media-${index + 1}.${ext ?? "bin"}`;
  }
}
