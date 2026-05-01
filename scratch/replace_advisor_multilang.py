import os

def replace_in_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # English
    content = content.replace('Agent', 'Agent')
    content = content.replace('agent', 'agent')
    content = content.replace('AGENT', 'AGENT')
    
    # Turkish
    content = content.replace('Ajanı', 'Ajanı')
    content = content.replace('Ajanlık', 'Ajanlık')
    content = content.replace('Ajan', 'Ajan')
    
    # Arabic
    content = content.replace('وكيل', 'وكيل')
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

file_path = r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\src\app\context\LanguageContext.tsx'
if os.path.exists(file_path):
    print(f"Processing {file_path}...")
    replace_in_file(file_path)
else:
    print(f"File not found: {file_path}")

print("Done!")
