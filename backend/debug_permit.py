import os
import json
import random
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash')

def get_all_responses(data):
    responses = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                responses.append(item)
            else:
                responses.extend(get_all_responses(item))
    elif isinstance(data, dict):
        for v in data.values():
            responses.extend(get_all_responses(v))
    return responses

agent_name = "permit"
responses_file = "agents/permit/responses.json"
with open(responses_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

all_intents = list(data.keys())
sampled_intents = random.sample(all_intents, min(8, len(all_intents)))

context_parts = []
for intent in sampled_intents:
    sub_responses = get_all_responses(data[intent])
    if sub_responses:
        example = random.choice(sub_responses)
        example = example.replace('\n', ' ').strip()
        if len(example) > 200:
            example = example[:200] + "..."
        context_parts.append(f"Topic: {intent}\nExample Response: {example}")

context_text = "\n\n".join(context_parts)

prompt = f"""
You are an AI Training Specialist for TurkGateway. 
Generate 5 unique, natural-sounding user questions for the '{agent_name}' agent.

FOCUS TOPICS: Permit, Student Life, and Legal (Lawyer) services in Turkey.
WEB CONTEXT: These questions should be related to what users would ask on the TurkGateway web platform.

AGENT KNOWLEDGE BASE (Samples):
{context_text}

REQUIREMENTS:
1. Generate exactly 5 NEW and diverse questions.
2. Return ONLY a JSON list of strings like ["Question 1", "Question 2", ...].
"""

try:
    response = model.generate_content(prompt)
    print("--- RAW RESPONSE ---")
    print(response.text)
except Exception as e:
    print(f"--- FAILURE ---")
    print(e)
