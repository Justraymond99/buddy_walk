export function buildCompanionShareUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  // Static viewer works on buddywalk.app (SPA hosting) without a server /companion/:token route.
  return `${trimmed}/companion-viewer.html?token=${encodeURIComponent(token)}`;
}
