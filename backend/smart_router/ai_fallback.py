"""
ai_fallback.py
--------------
Last-resort AI call used only when:
  1. No keyword match found
  2. No predefined response found
  3. No cache hit

Reuses the existing Gemini model instances from main.py (passed in at call time)
so the agent's full system prompt is preserved.

HISTORY IS ALWAYS SENT and placed FIRST in the prompt so the AI understands
it is mid-conversation — fixes the "Hi! Let's get things moving" bug after
the user says a short reply like "NO".
"""

import asyncio
from typing import Optional

# Conciseness constraint for fresh conversations
_CONCISE_SUFFIX = (
    "\n\n[INSTRUCTION: Answer directly and specifically. "
    "Give real specifics: names, fees, timelines, portal URLs. "
    "End with at most one focused follow-up question if something critical is missing.]"
)


async def ai_fallback_response(
    query: str,
    assistant_type: str = "permit",
    gemini_model=None,
    student_model=None,
    lawyer_model=None,
    rag_context: list = None,
    language: str = "en",
    history_text: str = "",
) -> Optional[str]:
    """
    Call the appropriate Gemini model for a fallback response.
    History is placed FIRST so the AI knows it is continuing an existing conversation.
    """
    model_map = {
        "permit": gemini_model,
        "student": student_model,
        "lawyer": lawyer_model,
    }
    model = model_map.get(assistant_type, gemini_model)

    if model is None:
        print(f"[AI Fallback] No model available for assistant_type={assistant_type}")
        return None

    # Persona per agent and language
    PERSONAS = {
        "permit": {
            "ar": "You are the Permit Expert at TurkGateway. Help with business permits in Istanbul.",
            "en": "You are the Permit Expert at TurkGateway. Answer warmly about business permits and municipal protocols in Istanbul.",
            "tr": "TurkGateway'in Ruhsat Uzmanisin. Istanbul'daki is ruhsatlari konusunda yardimci ol.",
        },
        "student": {
            "ar": "You are the Student Agent at TurkGateway. Help students with university registration, visas, ikamet, and campus life in Turkey.",
            "en": "You are the Student Agent at TurkGateway. Help with ALL student topics: university registration, visas, ikamet, scholarships, deadlines, KYK dorms.",
            "tr": "TurkGateway'in Ogrenci Danismanisin. Universite kaydi, vize, ikamet ve ogrenci konularinda yardimci ol.",
        },
        "lawyer": {
            "ar": "You are the Legal Counsel at TurkGateway. Help with Turkish law: contracts, company formation, employment, criminal, real estate, debt.",
            "en": "You are the Legal Counsel at TurkGateway. Help with Turkish law: contracts, company formation, employment disputes, criminal cases, real estate, debt collection.",
            "tr": "TurkGateway'in Hukuk Danisman'isin. Turk hukuku konularinda yardimci ol.",
        },
    }

    lang_lib = PERSONAS.get(assistant_type, PERSONAS["permit"])
    role_persona = lang_lib.get(language, lang_lib["en"])

    lang_guard = (
        f"\n\n[LANGUAGE RULE: Write your ENTIRE response in {language.upper()} only.]"
        if language != "en"
        else "\n\n[LANGUAGE RULE: Write your entire response in ENGLISH. Do NOT start with 'Merhaba'.]"
    )

    # ------------------------------------------------------------------
    # Determine if this is a continuation or a fresh conversation
    # ------------------------------------------------------------------
    is_continuation = bool(history_text and history_text.strip())

    if is_continuation:
        # CONTINUATION GUARD — the fix for the "Hi!" bug
        continuation_rules = (
            "\n\n[CRITICAL RULES — READ BEFORE RESPONDING:\n"
            "1. You are CONTINUING an EXISTING conversation shown above.\n"
            "2. DO NOT say 'Hi!', 'Hello!', 'Hey!', 'Let's get things moving', "
            "or ANY greeting whatsoever. Start your answer directly.\n"
            "3. The user's latest message is a DIRECT REPLY to your last message "
            "in the conversation above. Treat it as such.\n"
            "4. If the user said 'NO' or a negative (no, nope, nah, hayir, la): "
            "acknowledge it naturally ('Got it!', 'No problem.') and move to the "
            "next logical step or question based on context.\n"
            "5. If the user said 'YES' or a positive: fulfill whatever you last offered.\n"
            "6. If the user made a correction ('I meant X', 'it was X', 'actually X'): "
            "acknowledge in ONE sentence, re-answer with the corrected info.\n"
            "7. Give real specifics: office names, fees, timelines, portal URLs.\n"
            "8. Do NOT repeat the full roadmap. Continue the conversation naturally.]"
        )

        prompt = (
            f"{role_persona}\n\n"
            f"=== CONVERSATION HISTORY ===\n"
            f"{history_text.strip()}\n"
            f"=== END OF HISTORY ===\n\n"
            f"The user just replied: {query}\n"
            f"{continuation_rules}"
            f"{lang_guard}"
        )
        max_tokens = 500

    else:
        # Fresh conversation
        prompt = (
            f"{role_persona}\n\n"
            f"User: {query}\n"
            f"{_CONCISE_SUFFIX}"
            f"{lang_guard}"
        )
        max_tokens = 600

    # RAG context override (when knowledge chunks are available)
    if rag_context:
        context_block = "\n\n".join(
            f"[{c.get('title', 'Source')}]: {c.get('chunk_text', '')}"
            for c in rag_context[:3]
        )
        history_section = (
            f"=== CONVERSATION HISTORY ===\n{history_text.strip()}\n=== END ===\n\n"
            if is_continuation else ""
        )
        prompt = (
            f"{role_persona}\n\n"
            f"Use this knowledge to answer:\n\n{context_block}\n\n"
            f"{history_section}"
            f"User: {query}"
            f"{_CONCISE_SUFFIX}"
            f"{lang_guard}"
        )
        max_tokens = 400

    try:
        print(f"[SmartRouter] AI FALLBACK | type={assistant_type} | lang={language} | continuation={is_continuation} | query='{query[:50]}'")
        response = await asyncio.to_thread(
            model.generate_content,
            prompt,
            generation_config={"max_output_tokens": max_tokens},
        )
        text = response.text.strip()

        if len(text) > 10 and not any(text.endswith(p) for p in [".", "!", "?", "]", ")", "}"]):
            print(f"[SmartRouter] WARNING: AI Fallback may be cut off: '...{text[-20:]}'")

        print(f"[SmartRouter] AI FALLBACK response ({len(text)} chars)")
        return text
    except Exception as e:
        print(f"[AI Fallback] Error: {e}")
        return None
