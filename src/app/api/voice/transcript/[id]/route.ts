export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { voiceCallTranscripts } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

/**
 * GET /api/voice/transcript/[id] — download one call as a .txt.
 *
 * Owner-only, and a foreign or purged id answers 404 exactly like a missing
 * one so the id space leaks nothing — the same rule /api/documents/[id] uses.
 *
 * The file is rendered here rather than stored rendered, so this layout can be
 * changed without a migration or a rewrite of existing rows.
 */

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Who each turn is attributed to in the file. Deliberately not localised:
 *  the transcript is a record, and a fixed pair of labels keeps it greppable
 *  and diffable regardless of the language the call was held in. */
const SPEAKER: Record<Turn['role'], string> = {
  user: 'Caller',
  assistant: 'Agent',
};

function renderTranscript(row: {
  id: number;
  turns: string;
  duration_seconds: number | null;
  language: string | null;
  assistant_type: string | null;
  created_at: Date | null;
}): string {
  let turns: Turn[] = [];
  try {
    const parsed = JSON.parse(row.turns);
    if (Array.isArray(parsed)) turns = parsed;
  } catch {
    // A row we cannot parse still produces a file, with the header and a note,
    // rather than a 500 — the user asked for whatever we have.
  }

  const when = row.created_at ? new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 19) : 'unknown';
  const header = [
    'VOICE CALL TRANSCRIPT',
    `Date      : ${when} UTC`,
    `Duration  : ${formatDuration(row.duration_seconds ?? 0)}`,
    `Language  : ${row.language ?? 'en'}`,
    `Agent     : ${row.assistant_type ?? 'permit'}`,
    `Turns     : ${turns.length}`,
    '='.repeat(60),
    '',
  ];

  if (!turns.length) {
    header.push('(no turns recorded)');
    return header.join('\r\n');
  }

  const lines = turns.map((t) => {
    const who = SPEAKER[t.role] ?? t.role;
    // Wrapping is left to whatever opens the file; a hard wrap here would
    // corrupt languages this code cannot measure the width of.
    return `${who}: ${String(t.content ?? '').trim()}`;
  });

  // CRLF throughout: these get opened in Notepad on Windows more often than
  // anywhere else, and LF-only renders there as one unbroken line.
  return header.concat(lines, ['']).join('\r\n');
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const transcriptId = Number(id);
    if (!Number.isInteger(transcriptId) || transcriptId <= 0) {
      return Response.json({ detail: 'Not found' }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(voiceCallTranscripts)
      .where(eq(voiceCallTranscripts.id, transcriptId))
      .limit(1);

    const row = rows[0];
    if (!row || row.user_id !== user.id) {
      return Response.json({ detail: 'Not found' }, { status: 404 });
    }

    const body = renderTranscript(row);
    const stamp = (row.created_at ? new Date(row.created_at) : new Date())
      .toISOString()
      .slice(0, 10);
    const filename = `voice-call-${stamp}-${row.id}.txt`;

    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('[api/voice/transcript/id]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
