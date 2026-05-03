import json

# Load English keys
with open('backend/agents/student/responses.json', encoding='utf-8', errors='ignore') as f:
    en_data = json.load(f)
en_keys = set(en_data.keys())

# Load Turkish keys
with open('backend/agents/student/responses_tr.json', encoding='utf-8', errors='ignore') as f:
    tr_data = json.load(f)
tr_keys = set(tr_data.keys())

# Load Arabic keys
with open('backend/agents/student/responses_ar.json', encoding='utf-8', errors='ignore') as f:
    ar_data = json.load(f)
ar_keys = set(ar_data.keys())

print("Missing in Turkish:", sorted(en_keys - tr_keys))
print("Missing in Arabic:", sorted(en_keys - ar_keys))

# Show samples
missing_tr = en_keys - tr_keys
missing_ar = en_keys - ar_keys

if missing_tr:
    for key in list(missing_tr)[:3]:
        print(f"\n{key} (EN sample):\n{en_data[key][0][:200]}...\n")
