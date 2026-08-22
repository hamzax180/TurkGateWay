import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * Kilo / OpenRouter provider shim.
 * Configure with `KILO_API_KEY` and `KILO_BASE_URL` (or use .env.kilo placement file).
 */

export const KILO_BASE_URL = process.env.KILO_BASE_URL || 'https://api.kilo.ai';
export const KILO_MODEL = process.env.KILO_MODEL || 'code';

export function hasKiloKey(): boolean {
  return Boolean(process.env.KILO_API_KEY);
}

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

export function kilo(model: string = KILO_MODEL) {
  if (!_provider) {
    _provider = createOpenAICompatible({
      name: 'kilo',
      baseURL: KILO_BASE_URL,
      apiKey: process.env.KILO_API_KEY ?? '',
    });
  }
  return _provider.chatModel(model);
}

export const KILO_PROVIDER_OPTIONS = {
  kilo: {},
} as const;
