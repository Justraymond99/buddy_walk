export function buildCompanionShareUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  const safe = token.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${trimmed}/companion-viewer.html?token=${encodeURIComponent(safe)}`;
}
