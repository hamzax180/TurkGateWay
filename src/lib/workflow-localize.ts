import { generateObject } from 'ai';
import { z } from 'zod';
import { qwen, hasQwenKey, QWEN_PROVIDER_OPTIONS } from './qwen';

/**
 * workflow-localize.ts
 * The deterministic roadmap builder only writes text in en/tr/ar/tk. For the
 * remaining listed languages (az, uz, kk, fa, ru) the structure stays
 * deterministic — titles, notes, document names and the summary are translated
 * natively by one Qwen call, and the translations are spliced back into the
 * same object.
 *
 * A map-based approach (every unique string → translation) survives the model
 * reordering or miscounting items: nothing can be dropped or duplicated, the
 * worst outcome is an odd wording in one string.
 */

export type LocalizableLang = 'az' | 'uz' | 'kk' | 'fa' | 'ru';

const LOCALIZED_LANGS: ReadonlySet<string> = new Set<LocalizableLang>(['az', 'uz', 'kk', 'fa', 'ru']);

/** Fallback: reuse the closest existing language's static texts. */
const BASE_LANG: Record<LocalizableLang, 'tr' | 'tk' | 'ar' | 'en'> = {
  az: 'tr',
  uz: 'tk',
  kk: 'tk',
  fa: 'ar',
  ru: 'en',
};

const LANG_NAME: Record<LocalizableLang, string> = {
  az: 'Azerbaijani (modern, Latin alphabet — not Turkish)',
  uz: 'Uzbek (modern, Latin alphabet — not Turkish and not Russian)',
  kk: 'Kazakh (modern, Cyrillic alphabet)',
  fa: 'Persian/Farsi (written right-to-left)',
  ru: 'Russian (Cyrillic)',
};

export function needsLocalization(lang: string): lang is LocalizableLang {
  return LOCALIZED_LANGS.has(lang);
}

export function fallbackLang(lang: LocalizableLang): 'tr' | 'tk' | 'ar' | 'en' {
  return BASE_LANG[lang];
}

/** Everything the roadmap carries as human-readable text. */
export interface WorkflowTextFields {
  execution_plan: { steps: Array<{ title: string; notes: string; docs: string[] }> };
  combined_result: {
    permits: string[];
    agencies: string[];
    documents: string[];
    steps: Array<{ title: string; description: string; documents: string[] }>;
    summary: string;
    business_type: string;
  };
}

function collectStrings(state: WorkflowTextFields): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s === 'string' && s.trim()) out.push(s);
  };
  for (const step of state.execution_plan.steps) {
    push(step.title);
    push(step.notes);
    step.docs.forEach(push);
  }
  for (const step of state.combined_result.steps) {
    push(step.title);
    push(step.description);
    step.documents.forEach(push);
  }
  state.combined_result.permits.forEach(push);
  state.combined_result.agencies.forEach(push);
  state.combined_result.documents.forEach(push);
  push(state.combined_result.summary);
  push(state.combined_result.business_type);
  return [...new Set(out)];
}

function applyTranslations<T extends WorkflowTextFields>(state: T, map: Record<string, string>): T {
  const tr = (s: string) => (map[s]?.trim() ? map[s] : s);
  const deep = JSON.parse(JSON.stringify(state)) as T;
  for (const step of deep.execution_plan.steps) {
    step.title = tr(step.title);
    step.notes = tr(step.notes);
    step.docs = step.docs.map(tr);
  }
  for (const step of deep.combined_result.steps) {
    step.title = tr(step.title);
    step.description = tr(step.description);
    step.documents = step.documents.map(tr);
  }
  deep.combined_result.permits = deep.combined_result.permits.map(tr);
  deep.combined_result.agencies = deep.combined_result.agencies.map(tr);
  deep.combined_result.documents = deep.combined_result.documents.map(tr);
  deep.combined_result.summary = tr(deep.combined_result.summary);
  deep.combined_result.business_type = tr(deep.combined_result.business_type);
  return deep;
}

/**
 * Translate every text field of a built workflow into `lang`.
 *
 * Returns `null` when the translation could not be produced — the caller then
 * rebuilds the roadmap with the closest base language, so the deliverable
 * never blocks on a model call.
 */
export async function localizeWorkflow<T extends WorkflowTextFields>(
  state: T,
  lang: string,
): Promise<T | null> {
  if (!needsLocalization(lang) || !hasQwenKey()) return state;

  const strings = collectStrings(state);
  if (!strings.length) return state;

  try {
    const { object } = await generateObject({
      model: qwen(),
      schema: z.object({ translations: z.record(z.string(), z.string()) }),
      providerOptions: QWEN_PROVIDER_OPTIONS,
      prompt: [
        `You are a professional translator for a Turkish bureaucracy guidance platform.`,
        `Translate every string below into ${LANG_NAME[lang]}.`,
        '',
        'Rules:',
        '- Think and write natively — never translate word-for-word through English.',
        '- Keep official Turkish institution names recognizable (e.g. "İşyeri Açma ve Çalışma Ruhsatı") — you may keep the original in parentheses after the translation.',
        '- Keep URLs, phone numbers and codes (NACE, SGK, MERSİS, LTD) unchanged.',
        '- Return a JSON object mapping each original string to its translation. Do not merge, split, reorder or omit any string.',
        '',
        'Strings:',
        ...strings.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n'),
    });

    return applyTranslations(state, object.translations ?? {});
  } catch (e) {
    console.warn('[workflow-localize] localization failed, will fall back', e);
    return null;
  }
}
