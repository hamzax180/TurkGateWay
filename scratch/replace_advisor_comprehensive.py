import os

def replace_in_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return # Skip binary or non-utf8 files
    
    original = content
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
    
    if content != original:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {file_path}")

root_dir = r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb'
extensions = ('.py', '.tsx', '.json', '.ts', '.js', '.md')

for root, dirs, files in os.walk(root_dir):
    if '.next' in root or 'node_modules' in root or '.git' in root:
        continue
    for file in files:
        if file.endswith(extensions):
            replace_in_file(os.path.join(root, file))

print("Comprehensive replacement done!")
