const BRIEF_MARKER = '[Voice reply:';
const LAST_METERS_MARKER = '[Last meters:';

/** Ask the model for short, spoken answers — works even when /api/text is proxied. */
export function withBriefReplyInstruction(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes(BRIEF_MARKER)) return trimmed;

  return (
    `${trimmed}\n\n` +
    `${BRIEF_MARKER} 1-3 short sentences max. Answer only what was asked. ` +
    `No greetings, filler, or "let me know if you need anything". ` +
    `For lists, give at most 2 items unless the user asked for more. ` +
    `For train times, station name first then minutes only.]`
  );
}

/**
 * Directions question with attached camera imagery: force the model to use the
 * image to guide the user to the physical door, not just read GPS steps.
 * Rides on the question text because we don't control the AI host's deploy.
 */
export function withLastMetersImageInstruction(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes(LAST_METERS_MARKER)) return trimmed;

  return (
    `${trimmed}\n\n` +
    `${LAST_METERS_MARKER} I attached an image/video of my surroundings. ` +
    `CRITICAL: do not just read the GPS directions. Analyze the image and use it to ` +
    `guide me exactly to the physical door or entrance relative to my current view.]`
  );
}
