/**
 * rag.ts
 * RAG (Retrieval-Augmented Generation) system.
 * Ports backend/smart_router/rag.py to Next.js.
 *
 * Uses Google text-embedding-004 to embed queries,
 * then searches knowledge_chunks via pgvector cosine similarity.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const EMBED_MODEL = 'models/text-embedding-004';
const SIMILARITY_THRESHOLD = 0.35;

// ── Embedding ────────────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EMBED_MODEL,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
        }),
      }
    );
    const data = await res.json() as { embedding?: { values?: number[] } };
    return data?.embedding?.values ?? [];
  } catch {
    return [];
  }
}

export async function embedDocument(text: string): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EMBED_MODEL,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
        }),
      }
    );
    const data = await res.json() as { embedding?: { values?: number[] } };
    return data?.embedding?.values ?? [];
  } catch {
    return [];
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export interface RagChunk {
  chunkText: string;
  title: string;
  category: string | null;
  similarity: number;
}

export async function retrieveChunks(
  query: string,
  agentType: string,
  language = 'en',
  topK = 3,
): Promise<RagChunk[]> {
  void language; // reserved for future language-filtered retrieval
  const embedding = await embedText(query);
  if (!embedding.length) return [];

  try {
    // Use raw pgvector cosine distance operator <=>
    const rows = await sql`
      SELECT
        kc.chunk_text,
        ka.title,
        ka.category,
        1 - (kc.embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
      FROM knowledge_chunks kc
      JOIN knowledge_articles ka ON kc.article_id = ka.id
      WHERE ka.agent_type = ${agentType}
      ORDER BY kc.embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${topK}
    `;

    return (rows as Array<{
      chunk_text: string;
      title: string;
      category: string | null;
      similarity: string | number;
    }>)
      .filter(r => parseFloat(String(r.similarity ?? 0)) >= SIMILARITY_THRESHOLD)
      .map(r => ({
        chunkText: r.chunk_text,
        title: r.title,
        category: r.category,
        similarity: parseFloat(String(r.similarity)),
      }));
  } catch {
    return [];
  }
}

// ── Generation ────────────────────────────────────────────────────────────────

export async function generateRagResponse(
  query: string,
  agentType: string,
  language: string,
  chunks: RagChunk[],
): Promise<string | null> {
  void agentType; // reserved for agent-specific prompting
  if (!chunks.length || !process.env.GEMINI_API_KEY) return null;

  const context = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.chunkText}`)
    .join('\n\n');

  const langName = language === 'tr' ? 'Turkish' : language === 'ar' ? 'Arabic' : 'English';

  const prompt = `You are an expert assistant. Answer the user's question using ONLY the provided context. Be conversational and helpful.

CONTEXT:
${context}

USER QUESTION: ${query}

RULES:
- Respond in ${langName}
- Use **bold** for key terms, bullet points for lists
- Be concise (2-3 paragraphs max)
- If context doesn't fully answer, say what you know and ask a clarifying question
- End with a follow-up question`;

  try {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const { generateText } = await import('ai');
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const { text } = await generateText({
      model: google('gemini-2.0-flash-exp'),
      prompt,
      maxOutputTokens: 400,
    });
    return text;
  } catch {
    return null;
  }
}
