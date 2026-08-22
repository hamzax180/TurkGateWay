/**
 * orchestrator.ts
 * One-shot (non-streaming) generation for the "automate this step" action in
 * the Dashboard — see src/app/workflow/step/automate/[stepId]/route.ts.
 *
 * Roadmap structure comes from protocol.buildWorkflow, not from the model, so
 * this only ever produces prose. Personas are shared with the chat agent via
 * prompts.ts.
 */

import { generateText } from 'ai';
import { qwen, hasQwenKey, QWEN_PROVIDER_OPTIONS } from './qwen';
import { buildSystemPrompt, normalizeAgent, normalizeLang } from './prompts';

export interface OrchestratorResult {
  content: string;
}

export async function orchestrate(
  query: string,
  assistantType: string,
  language: string,
): Promise<OrchestratorResult> {
  if (!hasQwenKey()) {
    throw new Error('Qwen is not configured on this server (DASHSCOPE_API_KEY is missing).');
  }

  const { text } = await generateText({
    model: qwen(),
    system: buildSystemPrompt({
      agent: normalizeAgent(assistantType),
      lang: normalizeLang(language),
      isStepQuery: true,
    }),
    prompt: query,
    maxOutputTokens: 1200,
    providerOptions: QWEN_PROVIDER_OPTIONS,
  });

  return { content: text };
}
