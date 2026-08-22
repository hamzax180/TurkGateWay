/**
 * turkmen-speech.ts
 * Makes Turkmen speakable, given that no TTS engine actually supports it.
 *
 * Checked and confirmed unavailable:
 *  - OpenAI gpt-4o-mini-tts: no Turkmen.
 *  - DashScope qwen3-tts: supported languages are chinese, english, german,
 *    italian, portuguese, spanish, japanese, korean, french, russian. No
 *    Turkmen, and no Turkish either.
 *
 * The workaround relies on Turkmen orthography being phonetic and the language
 * being closely related to Turkish. A Turkish voice reading Turkmen text is
 * already broadly intelligible; transliterating the handful of letters whose
 * sound values differ between the two alphabets makes it markedly better.
 *
 * The mapping targets Turkish orthography specifically, so it must only be
 * applied when the text is about to be read by a Turkish voice. That is the
 * only caller: /api/voice/tts, which routes lang 'tk' to the Turkish neural
 * voice. If a genuine Turkmen voice ever appears, skip it entirely.
 */

/**
 * Turkmen → Turkish letter mapping.
 *
 * Order matters for the y/ý pair conceptually, though they are distinct
 * codepoints (U+0079 vs U+00FD) so the replacements cannot collide.
 *
 *   y  /ɯ/  → ı   Turkmen y is the back unrounded vowel, Turkish writes it ı
 *   ý  /j/  → y   Turkmen ý is the glide, which Turkish writes y
 *   j  /dʒ/ → c   Turkish c carries the /dʒ/ sound
 *   ž  /ʒ/  → j   Turkish j carries the /ʒ/ sound
 *   ä  /æ/  → e   Turkish has no ä; e is the nearest vowel
 *   ň  /ŋ/  → n   Turkish has no velar nasal
 *   w  /w/  → v   Turkish v is the nearest approximant
 *
 * ç, ş, ö, ü, g, k already agree between the two alphabets and are left alone.
 */
const TURKMEN_TO_TURKISH: Array<[RegExp, string]> = [
  [/y/g, 'ı'], [/Y/g, 'I'],
  [/ý/g, 'y'], [/Ý/g, 'Y'],
  [/j/g, 'c'], [/J/g, 'C'],
  [/ž/g, 'j'], [/Ž/g, 'J'],
  [/ä/g, 'e'], [/Ä/g, 'E'],
  [/ň/g, 'n'], [/Ň/g, 'N'],
  [/w/g, 'v'], [/W/g, 'V'],
];

/** Rewrite Turkmen into Turkish spelling so a Turkish voice pronounces it. */
export function turkmenToTurkishPhonetic(text: string): string {
  let out = text;
  for (const [re, to] of TURKMEN_TO_TURKISH) out = out.replace(re, to);
  return out;
}
