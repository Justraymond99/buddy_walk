export function buildCompanionShareUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  const safe = token.replace(/[^a-zA-Z0-9_-]/g, '');
  // /companion/:token is handled by the buddywalk.app SPA map viewer route.
  return `${trimmed}/companion/${encodeURIComponent(safe)}`;
}
