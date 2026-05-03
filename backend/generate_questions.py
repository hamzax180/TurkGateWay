import os
import json
import random
import google.generativeai as genai
from dotenv import load_dotenv
from typing import Dict, List

# Setup environment and API
# Note: We prioritize the project's .env file for the GOOGLE_API_KEY
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    # Try searching in the parent directory if run from backend/
    load_dotenv("../.env")
    api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    print("❌ ERROR: GOOGLE_API_KEY not found in .env file.")
    exit(1)

genai.configure(api_key=api_key)

# Using gemini-flash-latest for maximum reliability in this environment
model = genai.GenerativeModel('gemini-flash-latest')

def get_all_responses(data) -> List[str]:
    """Recursively extracts all strings from a nested dictionary/list structure."""
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

def generate_agent_questions(agent_name: str, data: Dict, existing: List[str] = []) -> List[str]:
    """Generates 5 unique questions, avoiding duplicates."""
    all_intents = list(data.keys())
    sampled_intents = random.sample(all_intents, min(10, len(all_intents)))
    
    context_parts = []
    for intent in sampled_intents:
        sub_responses = get_all_responses(data[intent])
        if sub_responses:
            example = random.choice(sub_responses).replace('\n', ' ')
            context_parts.append(f"Topic: {intent} | Example: {example[:150]}")

    context_text = "\n".join(context_parts)
    avoid_text = "\n".join([f"- {q}" for q in existing[-15:]])

    prompt = f"""
    Agent: {agent_name}
    Knowledge:
    {context_text}
    
    Previous Questions (AVOID THESE):
    {avoid_text}

    Generate 5 NEW, unique user questions for this agent in JSON format.
    Example: ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"]
    """

    try:
        response = model.generate_content(prompt)
        # Check if the response was blocked
        if response.candidates and response.candidates[0].finish_reason == 3: # SAFETY
            safe_print(f"  [Safety Block] for {agent_name}")
            return []
            
        text = response.text.strip()
        
        # Robust JSON extraction
        start = text.find('[')
        end = text.rfind(']')
        if start != -1 and end != -1:
            raw_json = text[start:end+1]
            questions = json.loads(raw_json)
            return [str(q).strip() for q in questions if q][:5]
    except Exception as e:
        safe_print(f"  [AI Error] {agent_name}: {type(e).__name__}")
        # if 'block' in str(e).lower(): safe_print(f"  Blocked: {e}")
    return []

def safe_print(msg):
    """Prints a message safely to console, handling potential encoding errors."""
    try:
        print(str(msg).encode('ascii', 'ignore').decode('ascii'))
    except:
        pass # Ultimate silence if even this fails

def main():
    safe_print(">>> Starting Question Generator...")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    agents_root = os.path.join(base_dir, "agents")
    output_path = os.path.join(base_dir, "fine_tuning_data.json")

    # Load existing state
    all_data = {}
    if os.path.exists(output_path):
        try:
            with open(output_path, 'r', encoding='utf-8') as f:
                all_data = json.load(f)
        except:
            pass

    # Process all agents
    for agent_dir in sorted(os.listdir(agents_root)):
        path = os.path.join(agents_root, agent_dir)
        if not os.path.isdir(path) or agent_dir.startswith("__"):
            continue
            
        responses_file = os.path.join(path, "responses.json")
        if os.path.exists(responses_file):
            safe_print(f"Processing: {agent_dir.upper()}")
            
            try:
                with open(responses_file, 'r', encoding='utf-8') as f:
                    resp_data = json.load(f)
                
                existing = all_data.get(agent_dir, [])
                new_qs = generate_agent_questions(agent_dir, resp_data, existing)
                
                if new_qs:
                    for q in new_qs:
                        if q not in existing:
                            existing.append(q)
                    all_data[agent_dir] = existing
                    safe_print(f"  Added {len(new_qs)} questions.")
                else:
                    safe_print(f"  Generation failed for {agent_dir}.")
            except Exception as e:
                safe_print(f"  Error: {type(e).__name__}")

    # Save final results
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)
    
    safe_print(f"Done! Saved to {output_path}")

if __name__ == "__main__":
    main()
