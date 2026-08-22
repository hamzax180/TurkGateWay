/**
 * response-quality.ts
 * Detects degenerate model output — the repetition-loop failure mode.
 *
 * Qwen handles English, Turkish and Arabic reliably, but Turkmen sits far
 * enough outside its training distribution that generation intermittently
 * collapses. Measured on a fixed 8-prompt Turkmen set, 2–3 replies per run
 * degenerate, in the worst cases emitting a single phrase for hundreds of
 * words ("ýagdaýy ýagdaýy we ýagdaýy ýagdaýy we …").
 *
 * Repetition penalties were tested and did not fix it, so the reply is
 * validated after generation instead and regenerated when it fails.
 */

export interface DegeneracyReport {
  degenerate: boolean;
  /** Share of distinct words, 0–1. Healthy prose sits well above 0.45. */
  uniqueRatio: number;
  /** Most-repeated 3–5 word phrase and how often it occurred. */
  topPhrase: string;
  topPhraseCount: number;
  reason?: 'repeated-phrase' | 'low-diversity' | 'too-short';
}

/** A phrase recurring this many times is a loop, not emphasis. */
const MAX_PHRASE_REPEATS = 5;
/** Below this share of distinct words, prose has collapsed. */
const MIN_UNIQUE_RATIO = 0.45;
/** Short replies are legitimately repetitive; don't judge them. */
const MIN_WORDS_TO_JUDGE = 40;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function detectDegeneration(text: string): DegeneracyReport {
  const w = words(text);

  if (w.length < MIN_WORDS_TO_JUDGE) {
    return {
      degenerate: false,
      uniqueRatio: w.length ? new Set(w).size / w.length : 1,
      topPhrase: '',
      topPhraseCount: 0,
      reason: 'too-short',
    };
  }

  // Count every 3–5 word phrase. A loop shows up as one phrase with a very
  // high count; ordinary repetition (a term of art, a list header) stays low.
  const counts = new Map<string, number>();
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const phrase = w.slice(i, i + n).join(' ');
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  let topPhrase = '';
  let topPhraseCount = 0;
  for (const [phrase, count] of counts) {
    if (count > topPhraseCount) {
      topPhrase = phrase;
      topPhraseCount = count;
    }
  }

  const uniqueRatio = new Set(w).size / w.length;

  if (topPhraseCount >= MAX_PHRASE_REPEATS) {
    return { degenerate: true, uniqueRatio, topPhrase, topPhraseCount, reason: 'repeated-phrase' };
  }
  if (uniqueRatio < MIN_UNIQUE_RATIO) {
    return { degenerate: true, uniqueRatio, topPhrase, topPhraseCount, reason: 'low-diversity' };
  }

  return { degenerate: false, uniqueRatio, topPhrase, topPhraseCount };
}
