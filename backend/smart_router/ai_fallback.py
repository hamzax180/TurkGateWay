"""
ai_fallback.py
--------------
Last-resort AI call used only when:
  1. No keyword match found
  2. No predefined response found
  3. No cache hit

Reuses the existing Gemini model instances from main.py (passed in at call time)
so the agent's full system prompt is preserved. Adds a conciseness constraint suffix
and caps output at 100 tokens.

Only the latest user message is sent — NO conversation history.
"""

import asyncio
from typing import Optional

# Conciseness constraint appended to every fallback call
_CONCISE_SUFFIX = (
    "\n\n[IMPORTANT: Reply in maximum 2 short sentences. "
    "No bullet lists. No boilerplate. Natural, friendly tone only.]"
)


async def ai_fallback_response(
    query: str,
    assistant_type: str = "permit",
    gemini_model=None,
    student_model=None,
    lawyer_model=None,
    rag_context: list = None,
) -> Optional[str]:
    """
    Call the appropriate Gemini model for a fallback response.
    If RAG context is available, it's injected into the prompt for grounded answers.
    """
    # Select the model matching the active agent
    model_map = {
        "permit": gemini_model,
        "student": student_model,
        "lawyer": lawyer_model,
    }
    model = model_map.get(assistant_type, gemini_model)

    if model is None:
        print(f"[AI Fallback] No model available for assistant_type={assistant_type}")
        return None

    # Build prompt with optional RAG context
    if rag_context:
        context_block = "\n\n".join(
            f"[{c.get('title', 'Source')}]: {c.get('chunk_text', '')}" 
            for c in rag_context[:3]
        )
        prompt = (
            f"Use the following knowledge to answer naturally and conversationally:\n\n"
            f"{context_block}\n\n"
            f"User question: {query}"
            f"{_CONCISE_SUFFIX}"
        )
        max_tokens = 200
    else:
        prompt = query + _CONCISE_SUFFIX
        max_tokens = 100

    try:
        print(f"[SmartRouter] AI FALLBACK triggered for assistant_type={assistant_type}, query='{query[:60]}'")
        response = await asyncio.to_thread(
            model.generate_content,
            prompt,
            generation_config={"max_output_tokens": max_tokens},
        )
        text = response.text.strip()
        print(f"[SmartRouter] AI FALLBACK response ({len(text)} chars)")
        return text
    except Exception as e:
        print(f"[AI Fallback] Error: {e}")
        return None

