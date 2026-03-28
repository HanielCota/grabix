export const IMAGE_EXTENSION_LIST = ["jpg", "jpeg", "png", "webp", "gif", "svg"] as const;
export const VIDEO_EXTENSION_LIST = ["mp4", "webm", "mov", "m4v", "ogg", "avi"] as const;
export const ALL_MEDIA_EXTENSION_LIST = [...IMAGE_EXTENSION_LIST, ...VIDEO_EXTENSION_LIST] as const;

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
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function extensionFromMime(mime: string): string | null {
  const clean = mime.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[clean] ?? null;
}

export function isVideoMime(mime: string): boolean {
  return mime.split(";")[0].trim().toLowerCase().startsWith("video/");
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

export function isMediaExtension(ext: string): boolean {
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
