/**
 * Proxy route for Kilo / DeepSeek debugging.
 *
 * Usage:
 * - POST /api/kilo/proxy with JSON body forwarded to the chosen provider's
 *   chat/completions endpoint.
 * - Choose target by header `x-target: deepseek` or `x-target: kilo`.
 * - If header is absent, set `USE_DEEPSEEK_FOR_KILO=true` in env to default
 *   to DeepSeek; otherwise defaults to Kilo.
 *
 * This keeps the main app using Qwen untouched — it's a separate, optional
 * relay, not part of the chat pipeline.
 *
 * Note: the Kilo Code VS Code extension does NOT need this route — it talks
 * to providers directly from its own settings inside VS Code. This only
 * matters if you specifically want a server-side DeepSeek/Kilo relay.
 *
 * requireAdmin, not requireUser: this spends your own DeepSeek/Kilo API
 * credits on whatever body is posted to it, so it's gated to admins the same
 * way /api/admin/* routes are, not opened to every signed-in user.
 */

import { requireAdmin } from '@/lib/user-helper';

export async function POST(req: Request) {
  try {
    await requireAdmin(req);

    const headerTarget = req.headers.get('x-target');
    const useDeepseekEnv = (process.env.USE_DEEPSEEK_FOR_KILO || 'false') === 'true';
    const target = headerTarget === 'deepseek' || (headerTarget === null && useDeepseekEnv) ? 'deepseek' : 'kilo';

    const body = await req.text();

    const deepseekBase = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const kiloBase = process.env.KILO_BASE_URL || 'https://api.kilo.ai';

    const endpoint = target === 'deepseek' ? `${deepseekBase}/chat/completions` : `${kiloBase}/chat/completions`;
    const apiKey = target === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.KILO_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing API key for target: ' + target }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    const text = await res.text();
    const contentType = res.headers.get('Content-Type') || 'application/json';

    return new Response(text, { status: res.status, headers: { 'Content-Type': contentType } });
  } catch (e: any) {
    if (e instanceof Response) return e; // the 401/403 from requireAdmin
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
