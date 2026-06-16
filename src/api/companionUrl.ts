export function buildCompanionShareUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}/companion/${encodeURIComponent(token)}`;
}
