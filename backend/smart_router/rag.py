"""
rag.py — RAG Retrieval Service
Embeds queries via Google text-embedding-004, searches pgvector for relevant chunks,
and generates grounded responses using Gemini.
"""

import asyncio
import os
from typing import List, Optional
import google.generativeai as genai
from sqlalchemy import text
from database import SessionLocal

# Embedding model config
_EMBED_MODEL = "models/text-embedding-004"
_EMBED_DIMENSIONS = 768


async def embed_text(content: str) -> List[float]:
    """Generate embedding vector for a text string."""
    try:
        result = await asyncio.to_thread(
            genai.embed_content,
            model=_EMBED_MODEL,
            content=content,
            task_type="retrieval_query",
        )
        return result["embedding"]
    except Exception as e:
        print(f"[RAG] Embedding error: {e}")
        return [0.0] * _EMBED_DIMENSIONS


async def embed_document(content: str) -> List[float]:
    """Generate embedding for a document (stored content)."""
    try:
        result = await asyncio.to_thread(
            genai.embed_content,
            model=_EMBED_MODEL,
            content=content,
            task_type="retrieval_document",
        )
        return result["embedding"]
    except Exception as e:
        print(f"[RAG] Document embedding error: {e}")
        return [0.0] * _EMBED_DIMENSIONS


async def retrieve_chunks(
    query: str,
    agent_type: str,
    language: str = "en",
    top_k: int = 3,
    similarity_threshold: float = 0.3,
) -> List[dict]:
    """
    Search knowledge chunks by vector similarity.
    Returns list of {chunk_text, title, category, similarity}.
    """
    query_embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    sql = text("""
        SELECT 
            kc.chunk_text,
            ka.title,
            ka.category,
            ka.tags,
            1 - (kc.embedding <=> CAST(:embedding AS vector)) AS similarity
        FROM knowledge_chunks kc
        JOIN knowledge_articles ka ON kc.article_id = ka.id
        WHERE ka.agent_type = :agent_type
        ORDER BY kc.embedding <=> CAST(:embedding AS vector)
        LIMIT :top_k
    """)

    try:
        db = SessionLocal()
        rows = db.execute(sql, {
            "embedding": embedding_str,
            "agent_type": agent_type,
            "top_k": top_k,
        }).fetchall()
        db.close()

        results = []
        for row in rows:
            sim = float(row.similarity) if row.similarity else 0.0
            if sim >= similarity_threshold:
                results.append({
                    "chunk_text": row.chunk_text,
                    "title": row.title,
                    "category": row.category,
                    "tags": row.tags,
                    "similarity": sim,
                })

        print(f"[RAG] Retrieved {len(results)} chunks for '{query[:50]}' (agent={agent_type})")
        return results

    except Exception as e:
        print(f"[RAG] Retrieval error: {e}")
        return []


async def generate_rag_response(
    query: str,
    agent_type: str,
    language: str = "en",
    gemini_model=None,
    retrieved_chunks: List[dict] = None,
) -> Optional[str]:
    """
    Generate a grounded response using retrieved knowledge chunks as context.
    """
    if not retrieved_chunks:
        retrieved_chunks = await retrieve_chunks(query, agent_type, language)

    if not retrieved_chunks:
        return None

    # Build context block from retrieved chunks
    context_parts = []
    for i, chunk in enumerate(retrieved_chunks, 1):
        context_parts.append(f"[Source {i}: {chunk['title']}]\n{chunk['chunk_text']}")
    context_block = "\n\n".join(context_parts)

    # Language instructions
    lang_map = {"tr": "Turkish", "ar": "Arabic", "en": "English"}
    lang_name = lang_map.get(language, "English")

    prompt = f"""You are a knowledgeable, warm, and professional agent. Answer the user's question using ONLY the provided context below. Be conversational and human — use emojis sparingly, be encouraging, and speak like a helpful friend who happens to be an expert.

CONTEXT (use this to answer):
{context_block}

USER QUESTION: {query}

RULES:
- Respond in {lang_name}
- Use the context to give a specific, accurate answer
- Be warm and conversational, not robotic
- Keep it concise (2-4 paragraphs max)
- If the context doesn't fully answer the question, say what you know and ask a clarifying question
- End with a helpful follow-up question to keep the conversation going"""

    if gemini_model is None:
        return None

    try:
        response = await asyncio.to_thread(
            gemini_model.generate_content,
            prompt,
            generation_config={"max_output_tokens": 300},
        )
        text_out = response.text.strip()
        print(f"[RAG] Generated response ({len(text_out)} chars)")
        return text_out
    except Exception as e:
        print(f"[RAG] Generation error: {e}")
        return None
