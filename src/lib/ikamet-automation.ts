/**
 * ikamet-automation.ts
 * The brain behind the e-İkamet (residence permit) automation.
 *
 * Qwen (the same DashScope model the agents use) turns the applicant's data
 * into a precise runbook for the portal: which fields the bot fills, and —
 * critically — which buttons the USER presses. The bot NEVER presses Next,
 * Apply or Save itself; those become `user_actions` that the dashboard
 * animates as a big "PRESS NEXT / PRESS APPLY" prompt on the user's screen.
 *
 * When the model key is missing or the call fails, the same structured
 * runbook falls back to the static field list, so the flow never breaks.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { qwen, hasQwenKey, QWEN_PROVIDER_OPTIONS } from './qwen';

export type BotFillAction = { field: string; value: string };
export type UserPressAction = { id: string; button: string; instruction: string };

export type PortalRunbook = {
  portal_name: string;
  target_url: string;
  /** Every field the bot fills, in the order the portal form asks for them. */
  bot_actions: BotFillAction[];
  /** Buttons only the human presses — never clicked by the automation. */
  user_actions: UserPressAction[];
  notes: string[];
};

const runbookSchema = z.object({
  portal_name: z.string(),
  target_url: z.string(),
  bot_actions: z.array(z.object({ field: z.string(), value: z.string() })),
  user_actions: z.array(
    z.object({ id: z.string(), button: z.string(), instruction: z.string() }),
  ),
  notes: z.array(z.string()),
});

const IKAMET_FIRST_URL = 'https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/IlkBasvuru';
const IKAMET_EXT_URL = 'https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru';

function staticIkametRunbook(fields: Record<string, string>, isExtension: boolean): PortalRunbook {
  const order: Array<[string, string]> = [
    ['Passport / YKN number', fields.passport_no ?? ''],
    ['Nationality', fields.nationality ?? ''],
    ['Date of birth', fields.dob ?? ''],
    ["Father's name", fields.father_name ?? ''],
    ["Mother's name", fields.mother_name ?? ''],
    ['Gender', fields.gender ?? ''],
    ['Passport type', fields.passport_type ?? ''],
    ['E-mail', fields.email ?? ''],
    ['Phone', fields.phone ?? ''],
  ];

  return {
    portal_name: 'e-İkamet',
    target_url: isExtension ? IKAMET_EXT_URL : IKAMET_FIRST_URL,
    bot_actions: order
      .filter(([, v]) => String(v).trim())
      .map(([field, value]) => ({ field, value: String(value).trim() })),
    user_actions: isExtension
      ? [
          { id: 'next-1', button: 'İLERİ (NEXT)', instruction: 'Press NEXT after the bot finishes the personal information section.' },
          { id: 'next-2', button: 'İLERİ (NEXT)', instruction: 'Press NEXT again to reach the application summary.' },
          { id: 'apply', button: 'BAŞVURU YAP (APPLY)', instruction: 'Check the summary, then press APPLY.' },
        ]
      : [
          { id: 'next-1', button: 'İLERİ (NEXT)', instruction: 'Press NEXT after the bot fills the personal information section.' },
          { id: 'next-2', button: 'İLERİ (NEXT)', instruction: 'Press NEXT to continue to the residence details.' },
          { id: 'save', button: 'KAYDET (SAVE)', instruction: 'Press SAVE when the form is complete.' },
          { id: 'apply', button: 'BAŞVURU YAP (APPLY)', instruction: 'Press APPLY to submit, then keep the application number.' },
        ],
    notes: [
      'The bot only fills fields — it never clicks a button on the portal.',
      'Keep the application (Başvuru) number shown after APPLY.',
    ],
  };
}

/** Qwen-generated runbook, with the static one as the safety net. */
export async function generateIkametRunbook(opts: {
  isExtension: boolean;
  fields: Record<string, string>;
}): Promise<{ runbook: PortalRunbook; mode: 'qwen' | 'static' }> {
  if (!hasQwenKey()) {
    return { runbook: staticIkametRunbook(opts.fields, opts.isExtension), mode: 'static' };
  }

  try {
    const { object } = await generateObject({
      model: qwen(),
      schema: runbookSchema,
      providerOptions: QWEN_PROVIDER_OPTIONS,
      prompt: [
        'You are the automation brain for an e-İkamet (Turkish residence permit) application on e-ikamet.goc.gov.tr.',
        opts.isExtension
          ? 'This is an EXTENSION (Uzatma) application.'
          : 'This is a FIRST application (İlk Başvuru).',
        '',
        'HARD RULE: the bot FILLS form fields only. It NEVER presses any button — not İleri (Next), not Kaydet (Save), not Başvuru Yap (Apply), not Randevu Al. Every button press is a user_action.',
        '',
        'Applicant data:',
        ...Object.entries(opts.fields)
          .filter(([, v]) => String(v).trim())
          .map(([k, v]) => `- ${k}: ${v}`),
        '',
        'Produce:',
        '1. bot_actions: every field the bot fills, with the exact portal label as "field" and the value as "value", in the order the form asks (passport/YKN first, then nationality, date of birth, parents names, gender, passport type, email, phone). Only include fields that have values.',
        '2. user_actions: the buttons the HUMAN presses, in order, each with an id, a short uppercase "button" label (e.g. "İLERİ (NEXT)", "BAŞVURU YAP (APPLY)") and a one-sentence "instruction". For a first application: NEXT after each section, SAVE, then APPLY. For an extension: NEXT, NEXT, APPLY.',
        '3. notes: two or three short warnings (never auto-click, save the application number, appointment comes after submission).',
        'portal_name must be "e-İkamet" and target_url exactly ' +
          (opts.isExtension ? IKAMET_EXT_URL : IKAMET_FIRST_URL) +
          '.',
      ].join('\n'),
    });

    return { runbook: object, mode: 'qwen' };
  } catch (err) {
    console.error('[ikamet-automation] qwen runbook failed, falling back to static', err);
    return { runbook: staticIkametRunbook(opts.fields, opts.isExtension), mode: 'static' };
  }
}
