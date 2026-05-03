import json

# Load with error handling
with open('backend/agents/student/responses.json', 'r', encoding='utf-8', errors='replace') as f:
    data = json.load(f)

# Write back cleanly with UTF-8
with open('backend/agents/student/responses.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("✅ Fixed encoding in responses.json")
