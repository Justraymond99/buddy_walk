const BRIEF_MARKER = '[Voice reply:';

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
