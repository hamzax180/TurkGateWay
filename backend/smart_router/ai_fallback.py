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
    language: str = "en",
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

    
    # Professional Persona Instructions
    PERSONAS = {
        "permit": {
            "ar": "أنت 'خبير التراخيص' في TurkGateway. أجب بأسلوب ودود وطبيعي على الأسئلة المتعلقة بتراخيص الأعمال والبلدية. إذا سألك المستخدم عن مواضيع جامعية أو قانونية بحتة، اطلب منه بلباقة التبديل إلى المستشار المناسب من الأعلى.",
            "en": "You are the 'Permit Expert' at TurkGateway. Answer in a warm, friendly and natural tone about business permits and municipal protocols. If the user asks about university or pure legal disputes, kindly suggest they switch to the right advisor from the mode selector."
        },
        "student": {
            "ar": "أنت 'مستشار الطلاب' في TurkGateway. أجب بأسلوب ودود ومشجع على الأسئلة المتعلقة بالدراسة والإقامة الطلابية والمنح. إذا سألك المستخدم عن فتح مشروع أو قضايا قانونية، اطلب منه التبديل إلى المستشار المناسب.",
            "en": "You are the 'Student Advisor' at TurkGateway. Answer in a warm, supportive tone about university, student residency, and academic life. If the user asks about business permits or legal issues, kindly ask them to switch to the right advisor."
        },
        "lawyer": {
            "ar": "أنت 'المستشار القانوني' في TurkGateway. أجب بأسلوب مهني لكن ودود على الاستشارات القانونية والعقود وتأسيس الشركات. إذا سألك المستخدم عن إجراءات طلابية أو تراخيص أعمال، اطلب منه التبديل للمستشار المناسب.",
            "en": "You are the 'Legal Counsel' at TurkGateway. Answer in a professional yet approachable tone about corporate law, contracts, and legal disputes. If the user asks about university registration or business permits, kindly ask them to switch to the right advisor."
        }
    }

    role_persona = PERSONAS.get(assistant_type, PERSONAS["permit"]).get(language, PERSONAS["permit"]["en"])
    
    lang_instruction = f"\n\n[PROMPT: {role_persona} Respond entirely in {language.upper()}. Use a professional and natural tone. Do not use English.]" if language != "en" else ""

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
            f"{lang_instruction}"
        )
        max_tokens = 200
    else:
        prompt = f"{role_persona}\n\nUser Question: {query}\n\n{_CONCISE_SUFFIX}"
        if language != "en":
            prompt += f"\n\n[CRITICAL: Respond ONLY in {language.upper()} language.]"
        else:
            prompt += f"\n\n[CRITICAL: Respond ONLY in ENGLISH language.]"
        max_tokens = 150

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

