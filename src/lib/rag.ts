/**
 * rag.ts
 * Retrieval half of the RAG pipeline: embed the query with DashScope's
 * text-embedding-v3, then search knowledge_chunks via pgvector cosine distance.
 *
 * Generation lives in agent-router.ts — retrieved chunks are injected into the
 * Qwen system prompt rather than answered by a separate model call.
 */

import { neon } from '@neondatabase/serverless';
import { QWEN_BASE_URL, QWEN_EMBED_MODEL, QWEN_EMBED_DIMENSIONS, hasQwenKey } from './qwen';

const sql = neon(process.env.DATABASE_URL!);

const SIMILARITY_THRESHOLD = 0.35;

// ── Embedding ────────────────────────────────────────────────────────────────

/**
 * DashScope's OpenAI-compatible /embeddings endpoint. `dimensions` is requested
 * explicitly so vectors match the knowledge_chunks vector(768) column.
 */
async function embed(text: string): Promise<number[]> {
  if (!hasQwenKey()) return [];
  try {
    const res = await fetch(`${QWEN_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: QWEN_EMBED_MODEL,
        input: text,
        dimensions: QWEN_EMBED_DIMENSIONS,
        encoding_format: 'float',
      }),
    });
    if (!res.ok) {
      console.error('[rag] embedding failed:', res.status, await res.text().catch(() => ''));
      return [];
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return data?.data?.[0]?.embedding ?? [];
  } catch (e) {
    console.error('[rag] embedding error:', e);
    return [];
  }
}

export const embedText = embed;
export const embedDocument = embed;

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
  const embedding = await embed(query);
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
