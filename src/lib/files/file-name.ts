const INVALID_FILE_CHARS_PATTERN = /[<>:"/\\|?*]/g;
const LEADING_TRAILING_DOTS_PATTERN = /^[.\s]+|[.\s]+$/g;
const MULTI_DOT_PATTERN = /\.\.+/g;

export const MAX_FILE_NAME_LENGTH = 255;

export function sanitizeFileName(input: string, fallback = "download"): string {
  const normalized = input.normalize("NFKC");
  const withoutControlChars = Array.from(normalized)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  let safe = withoutControlChars.replace(INVALID_FILE_CHARS_PATTERN, "_").replace(/\s+/g, " ").trim();

  safe = safe.replace(MULTI_DOT_PATTERN, "_");
  safe = safe.replace(LEADING_TRAILING_DOTS_PATTERN, "");

  if (!safe) {
    safe = fallback;
  }

  if (safe.length <= MAX_FILE_NAME_LENGTH) {
    return safe;
  }

  const dotIndex = safe.lastIndexOf(".");
  if (dotIndex > 0) {
    const ext = safe.slice(dotIndex);
    const base = safe.slice(0, dotIndex);
    const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - ext.length);
    return `${base.slice(0, maxBaseLength)}${ext}`;
  }

  return safe.slice(0, MAX_FILE_NAME_LENGTH);
}

export function buildContentDisposition(fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const asciiFallback = safe
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
