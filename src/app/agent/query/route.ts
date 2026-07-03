export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { users, chatSessions, chatMessages } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getOptionalUser, shouldResetTokens, defaultTokens, tokenPayload } from '@/lib/user-helper';
import { smartRouter } from '@/lib/smart-router';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { redis } from '@/lib/redis';

// Rate limiting only works when Upstash is configured
const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const ratelimit = hasUpstash
  ? new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(10, '60 s'),
      analytics: false,
    })
  : null;

export async function POST(req: Request) {
  try {
    // Parse multipart or JSON
    let query = '';
    let language = 'en';
    let sessionId = '';
    let assistantType = 'permit';
    let isStepQuery = false;
    let bodyJson: any = null;

    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      query = String(form.get('query') ?? '');
      language = String(form.get('language') ?? 'en');
      sessionId = String(form.get('session_id') ?? '');
      assistantType = String(form.get('assistant_type') ?? 'permit');
    } else {
      const body = await req.json();
      bodyJson = body;
      query = body.query ?? '';
      language = body.language ?? 'en';
      sessionId = body.context?.session_id ?? body.session_id ?? '';
      assistantType = body.assistant_type ?? 'permit';
      isStepQuery = body.is_step_query === true;
    }

    if (!query.trim()) {
      return Response.json({ detail: 'Query required' }, { status: 400 });
    }

    // Auth (optional — guests allowed)
    let user = await getOptionalUser(req);

    // Rate limit by user id or IP
    const identifier = user ? `user:${user.id}` : (req.headers.get('x-forwarded-for') ?? 'anon');
    const { success } = ratelimit
      ? await ratelimit.limit(identifier).catch(() => ({ success: true }))
      : { success: true };
    if (!success) {
      return Response.json({ detail: 'Too many requests' }, { status: 429 });
    }

    // Token balance check + reset
    if (user) {
      if (shouldResetTokens(user)) {
        const balance = defaultTokens(user);
        await db.update(users).set({ token_balance: balance, last_token_reset: new Date() }).where(eq(users.id, user.id));
        user = { ...user, token_balance: balance, last_token_reset: new Date() };
      }

      if ((user.token_balance ?? 0) <= 0) {
        const reset = new Date(user.last_token_reset ?? new Date());
        const isActive = user.subscription_status === 'active';
        reset.setTime(reset.getTime() + (isActive ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
        const resetStr = reset.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        return Response.json({ detail: `Model quota reached|${resetStr}` }, { status: 403 });
      }
    }

    // Fetch recent chat history for context engine (last 6 messages)
    let recentMessages: Array<{ role: string; content: string }> = [];
    if (bodyJson && bodyJson.history && Array.isArray(bodyJson.history)) {
      recentMessages = bodyJson.history.map((m: any) => ({
        role: String(m.role),
        content: String(m.content)
      })).slice(-6);
    } else if (sessionId && !sessionId.startsWith('guest-')) {
      try {
        const rows = await db
          .select({ role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.session_id, sessionId))
          .orderBy(chatMessages.timestamp)
          .limit(6);
        recentMessages = rows;
      } catch { /* DB unavailable — skip context */ }
    }

    // First name for personalized greetings (logged-in users only)
    const firstName = user?.full_name ? String(user.full_name).trim().split(/\s+/)[0] : undefined;

    // Smart Router (6-layer pipeline with context engine)
    const result = await smartRouter(query, language, assistantType, sessionId || undefined, recentMessages, firstName, isStepQuery);

    // Save message to history database if authenticated session and save_history !== false
    const shouldSave = bodyJson?.save_history !== false;
    if (shouldSave && sessionId && !sessionId.startsWith('guest-')) {
      try {
        await db.insert(chatMessages).values([
          { session_id: sessionId, role: 'user', content: query },
          { session_id: sessionId, role: 'assistant', content: result.content }
        ]);
      } catch (dbErr) {
        console.error('Failed to save message history to DB:', dbErr);
      }
    }

    // Deduct 1 token for authenticated users on non-cache responses
    let newBalance = user?.token_balance ?? null;
    if (user && result.source !== 'cache' && result.source !== 'keyword') {
      newBalance = Math.max(0, (user.token_balance ?? 1) - 1);
      await db.update(users).set({ token_balance: newBalance }).where(eq(users.id, user.id));
    }

    // Auto-generate session title from first message
    let sessionTitle: string | null = null;
    if (sessionId && user) {
      const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
      if (session && !session.title) {
        sessionTitle = query.length > 50 ? query.slice(0, 47) + '...' : query;
        await db.update(chatSessions).set({ title: sessionTitle, updated_at: new Date() }).where(eq(chatSessions.id, sessionId));
      }
    }

    return Response.json({
      content: result.content,
      answer: result.content,
      response: result.content,
      source: result.source,
      token_balance: newBalance,
      session_title: sessionTitle,
      dashboard_state: result.dashboard_state,
    });
  } catch (e: any) {
    console.error('[agent/query]', e);
    return Response.json({ detail: 'Internal error' }, { status: 500 });
  }
}
