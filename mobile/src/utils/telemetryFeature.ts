/** Low-cardinality feature labels for analytics dashboards. */
export type TelemetryFeature =
  | 'photo_qa'
  | 'video_qa'
  | 'voice_qa'
  | 'directions'
  | 'mta'
  | 'saved_places'
  | 'location_qa'
  | 'general';

export function classifyFeature(input: {
  text: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  savedAliases?: string[];
}): TelemetryFeature {
  const t = input.text.toLowerCase();

  if (input.savedAliases && input.savedAliases.length > 0) return 'saved_places';
  if (/train arriving|next .* train|subway|mta/.test(t)) return 'mta';
  if (/how do i get|directions|walk to|get to|navigate to/.test(t)) return 'directions';
  if (input.hasVideo || /describe the video/.test(t)) return 'video_qa';
  if (input.hasImage) return 'photo_qa';
  if (/what street|intersection|near me|where am i|what direction/.test(t)) return 'location_qa';

  return 'general';
}

export function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
