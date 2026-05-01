import re

with open('src/app/context/LanguageContext.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

seen = {}
duplicates = []

for i, line in enumerate(lines, 1):
    stripped = line.strip()
    match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*['\"]", stripped)
    if match:
        key = match.group(1)
        if key in seen:
            duplicates.append((i, key, seen[key]))
        else:
            seen[key] = i

print(f'Found {len(duplicates)} duplicate keys:')
for line_num, key, first_line in duplicates:
    print(f'  Line {line_num}: "{key}" (first at line {first_line})')
