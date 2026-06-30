/** Open the wearer's pin in the system maps app — works with no Buddy Walk backend. */
export function buildMapsShareUrl(lat: number, lon: number, label?: string): string {
  const q = label?.trim()
    ? `${encodeURIComponent(label)}@${lat},${lon}`
    : `${lat},${lon}`;
  return `https://maps.google.com/?q=${q}`;
}
