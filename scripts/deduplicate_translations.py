import re

def deduplicate():
    with open('src/app/context/LanguageContext.tsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # Define blocks
    blocks = re.split(r'(\s+(?:en|tr|ar):\s*\{)', content)

    new_content = blocks[0]
    for i in range(1, len(blocks), 2):
        header = blocks[i]
        body = blocks[i+1]
        
        # Split body into lines but keep footer (the closing brace for the block)
        # We find the LAST closing brace for the block
        end_match = re.search(r'\n\s*\},\s*(?:\n|$)', body)
        if not end_match:
            # Maybe it's the last one
            end_match = re.search(r'\n\s*\},?\s*\n\};', body)
            
        if end_match:
            main_body = body[:end_match.start()]
            footer = body[end_match.start():]
        else:
            main_body = body
            footer = ''
        
        lines = main_body.split('\n')
        seen_keys = set()
        new_lines = []
        for line in lines:
            # Match keys like '  key: "value",' or '  key: "value"'
            match = re.match(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*['\"]", line.strip())
            if match:
                key = match.group(1)
                if key not in seen_keys:
                    new_lines.append(line)
                    seen_keys.add(key)
                else:
                    # Duplicate key, skip it
                    pass
            else:
                new_lines.append(line)
                
        new_content += header + '\n'.join(new_lines) + footer

    with open('src/app/context/LanguageContext.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == '__main__':
    deduplicate()
