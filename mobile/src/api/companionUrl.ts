export function buildCompanionShareUrl(
  token: string,
  baseUrl: string,
  companionApiRoot?: string
): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  const safe = token.replace(/[^a-zA-Z0-9_-]/g, '');
  let url = `${trimmed}/companion-viewer.html?token=${encodeURIComponent(safe)}`;
  const api = companionApiRoot?.replace(/\/+$/, '').replace(/\/api$/i, '');
  if (api && !trimmed.startsWith(api)) {
    url += `&api=${encodeURIComponent(api)}`;
  }
  return url;
}
