const PROXIED_PREVIEW_HOSTS = new Set([
  "datahub.creodias.eu",
  "zipper.creodias.eu",
]);

export function displayPreviewUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && PROXIED_PREVIEW_HOSTS.has(parsed.hostname.toLowerCase())) {
      return `/api/preview?url=${encodeURIComponent(parsed.toString())}`;
    }
  } catch {
    return null;
  }
  return url;
}
