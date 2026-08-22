/**
 * qwen.ts
 * Single place any Alibaba DashScope / Qwen configuration is read.
 *
 * DashScope exposes an OpenAI-compatible API, so the AI SDK's
 * openai-compatible provider talks to it directly — chat completions and
 * embeddings both live under the same base URL.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/**
 * qwen3.8-max measured best of the current line-up on Turkmen (n=12 per model):
 * fewest Turkish leaks (0.36% vs 0.80% for the legacy qwen-plus alias) and the
 * lowest latency. Note "qwen-max" is a *legacy* alias and is a different, much
 * older model — it answered in near-pure Turkish and must not be used here.
 */
export const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.8-max';

export const QWEN_EMBED_MODEL = process.env.QWEN_EMBED_MODEL || 'text-embedding-v3';

/** Embedding width requested from DashScope — matches the knowledge_chunks vector(768) column. */
export const QWEN_EMBED_DIMENSIONS = 768;

export function hasQwenKey(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

/**
 * Lazily built so importing this module never throws when the key is absent —
 * callers guard with hasQwenKey() and surface a 503 instead.
 */
export function qwen(model: string = QWEN_MODEL) {
  if (!_provider) {
    _provider = createOpenAICompatible({
      name: 'dashscope',
      baseURL: QWEN_BASE_URL,
      apiKey: process.env.DASHSCOPE_API_KEY ?? '',
    });
  }
  return _provider.chatModel(model);
}

/**
 * Extra body fields for every DashScope call.
 *
 * Qwen3 models default to "thinking" mode, which burns thousands of reasoning
 * tokens before answering — measured at 51s vs 8.6s for the same prompt. These
 * are short advisory answers, not maths problems, so it is pure cost and lag.
 *
 * The openai-compatible provider spreads providerOptions[<provider name>]
 * straight into the request body, so this reaches DashScope as-is.
 */
export const QWEN_PROVIDER_OPTIONS = {
  dashscope: { enable_thinking: false },
} as const;
