import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * DeepSeek provider shim.
 *
 * The API host is api.deepseek.com — platform.deepseek.com is the account
 * dashboard, not an API endpoint, and requests to it will fail. Configure via
 * the `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` env vars.
 *
 * Note: this is only needed if something server-side (e.g. /api/kilo/proxy)
 * calls DeepSeek directly. The Kilo Code VS Code extension does NOT use this —
 * it talks to providers straight from its own settings inside VS Code.
 */

export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

export function hasDeepseekKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

export function deepseek(model: string = DEEPSEEK_MODEL) {
  if (!_provider) {
    _provider = createOpenAICompatible({
      name: 'deepseek',
      baseURL: DEEPSEEK_BASE_URL,
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    });
  }
  return _provider.chatModel(model);
}

export const DEEPSEEK_PROVIDER_OPTIONS = {
  deepseek: {},
} as const;
