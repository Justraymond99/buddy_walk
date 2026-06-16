import type { NavRoute, NavStep } from '../types';

/**
 * Best-effort regex parser for AI responses that include walking directions
 * but no structured route payload (e.g. older backends, or when the AI
 * paraphrased the steps it was given).
 *
 * Returns `null` if no plausible "Step N) ..." style enumeration is detected.
 *
 * The resulting steps have placeholder coordinates (0,0). They can still drive
 * spoken / haptic playback, but proximity-based step advancement is disabled
 * for these (the navigator falls back to manual "Next" / "Repeat").
 */
export function parseStepsFromText(text: string): NavRoute | null {
  if (!text) return null;
  const collected: { idx: number; instruction: string }[] = [];

  // Pattern A: "Step 1) ..." or "Step 1. ..."
  const stepRegex = /(?:^|\n)\s*step\s*(\d+)\s*[\.\):\-]\s*([^\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = stepRegex.exec(text)) !== null) {
    const idx = parseInt(match[1], 10) - 1;
    const instruction = cleanInstruction(match[2]);
    if (instruction) collected.push({ idx, instruction });
  }

  // Pattern B: numbered list "1) ..." / "1. ..." — only if Pattern A produced nothing
  if (collected.length === 0) {
    const numbered = /(?:^|\n)\s*(\d+)\s*[\.\):]\s*([^\n]+)/g;
    while ((match = numbered.exec(text)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      const instruction = cleanInstruction(match[2]);
      if (instruction && looksLikeDirectionLine(instruction)) {
        collected.push({ idx, instruction });
      }
    }
  }

  // Pattern C: imperative directional sentences split by period — last resort
  if (collected.length === 0) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s && looksLikeDirectionLine(s));
    sentences.forEach((s, i) => {
      collected.push({ idx: i, instruction: s });
    });
  }

  if (collected.length === 0) return null;

  // De-duplicate by index, sort, and renumber so consumers can iterate by position.
  const byIdx = new Map<number, string>();
  collected.forEach((s) => byIdx.set(s.idx, s.instruction));
  const ordered = Array.from(byIdx.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, instruction], i) => ({ index: i, instruction }));

  const steps: NavStep[] = ordered.map((s) => ({
    index: s.index,
    instruction: s.instruction,
    distance: { text: '', value: 0 },
    duration: { text: '', value: 0 },
    maneuver: inferManeuverFromText(s.instruction),
    startLocation: { lat: 0, lng: 0 },
    endLocation: { lat: 0, lng: 0 },
  }));

  // Make sure the last step looks like an arrival so the long-buzz fires.
  const last = steps[steps.length - 1];
  if (last && !last.maneuver.includes('arrive') && /(arrive|destination|you'?ve arrived|you will arrive)/i.test(last.instruction)) {
    last.maneuver = 'arrive';
  }

  return {
    destination: { lat: 0, lng: 0 },
    steps,
  };
}

/**
 * Best-effort extraction of the destination phrase from a natural-language
 * navigation query, e.g. "how do I get to Trader Joe's?" -> "Trader Joe's".
 * Used to geocode a destination coordinate for routes that arrive without one,
 * so GPS can confirm exact arrival. Returns null when no destination is found.
 */
export function extractDestinationQuery(query: string): string | null {
  if (!query) return null;
  const q = query.trim();
  const patterns = [
    /(?:directions?|route|navigate|walk|head|take me|get me|bring me)\s+(?:to|toward|towards)\s+(.+)/i,
    /how\s+(?:do|can|would|could)\s+i\s+(?:get|walk|go)\s+(?:to|toward|towards)\s+(.+)/i,
    /(?:go|get|walk)\s+to\s+(.+)/i,
    /\bto\s+(.+)/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m && m[1]) {
      const dest = m[1]
        .replace(/[?.!]+\s*$/, '')
        .replace(/^(the|a|an)\s+/i, '')
        .trim();
      if (dest.length >= 2) return dest;
    }
  }
  return null;
}

function cleanInstruction(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/\s+for\s+[\d.]+\s*(?:ft|feet|m|meters|km|mi|miles)\s*\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIRECTION_HINT =
  /\b(turn|head|continue|proceed|walk|go|cross|bear|merge|take|arrive|destination|north|south|east|west|left|right)\b/i;

function looksLikeDirectionLine(s: string): boolean {
  return DIRECTION_HINT.test(s) && s.length < 240;
}

/**
 * Infers a Google-style maneuver token from natural language. Conservative —
 * only returns a turn when the wording is unambiguous, otherwise "straight".
 */
export function inferManeuverFromText(text: string): string {
  const t = text.toLowerCase();
  if (/(arrive|you'?ve arrived|you have arrived|destination is|reach (?:the )?destination)/.test(t)) {
    return 'arrive';
  }
  if (/u[\s\-]?turn/.test(t)) return 'uturn-left';
  if (/sharp\s+left/.test(t)) return 'turn-sharp-left';
  if (/sharp\s+right/.test(t)) return 'turn-sharp-right';
  if (/slight\s+left|bear\s+left/.test(t)) return 'turn-slight-left';
  if (/slight\s+right|bear\s+right/.test(t)) return 'turn-slight-right';
  if (/(turn|make a|take a)\s+left/.test(t)) return 'turn-left';
  if (/(turn|make a|take a)\s+right/.test(t)) return 'turn-right';
  if (/\bleft\b/.test(t) && !/\bon (?:your )?left\b/.test(t)) return 'turn-left';
  if (/\bright\b/.test(t) && !/\bon (?:your )?right\b/.test(t)) return 'turn-right';
  return 'straight';
}
