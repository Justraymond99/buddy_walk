/** Shapes Last Meters test log rows for the admin API and dashboard. */

export interface LastMileTestImageFields {
  userPhoto?: string;
  panoramaPhoto?: string;
  destinationPhoto?: string;
}

export interface LastMileTestImageFlags {
  hasUserPhoto: boolean;
  hasPanorama: boolean;
  hasDestinationPhoto: boolean;
}

/** Only data URLs are stored images the dashboard can render. */
export function isStoredImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

export function imagePlaceholder(value?: string): string {
  return value ? `[base64 image ${value.length} chars]` : "";
}

/**
 * Adds explicit image presence flags and, unless includeImages is set, swaps the
 * base64 payloads for short placeholders so list views stay light.
 */
export function toLastMileTestResponse<T extends LastMileTestImageFields>(
  row: T,
  includeImages: boolean
): T & LastMileTestImageFlags {
  const flags: LastMileTestImageFlags = {
    hasUserPhoto: isStoredImage(row.userPhoto),
    hasPanorama: isStoredImage(row.panoramaPhoto),
    hasDestinationPhoto: isStoredImage(row.destinationPhoto),
  };
  if (includeImages) return { ...row, ...flags };
  return {
    ...row,
    ...flags,
    userPhoto: imagePlaceholder(row.userPhoto),
    panoramaPhoto: imagePlaceholder(row.panoramaPhoto),
    destinationPhoto: imagePlaceholder(row.destinationPhoto),
  };
}
