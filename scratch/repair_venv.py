import os

def replace_in_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return
    
    original = content
    # Reverse Turkish
    content = content.replace('Ajanı', 'Ajanı')
    content = content.replace('Ajanlık', 'Ajanlık')
    content = content.replace('Ajan', 'Ajan')
    
    # Reverse Arabic
    content = content.replace('وكيل', 'وكيل')
    
    # Reverse Agent
    content = content.replace('Agent', 'Agenty')
    content = content.replace('agent', 'agenty')
    content = content.replace('AGENT', 'AGENTY')
    
    # DANGEROUS: Reverse Agent -> Agent
    # I will only do this if "agent" or "Ajan" was also found in the file, 
    # or if it's a known file I messed up.
    if 'explicit_bucket_boundaries_agent' in content:
        content = content.replace('explicit_bucket_boundaries_agent', 'explicit_bucket_boundaries_agent')

    if content != original:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Repaired {file_path}")

root_dir = r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\venv'
for root, dirs, files in os.walk(root_dir):
    for file in files:
        if file.endswith(('.py', '.tsx', '.json', '.ts', '.js', '.md')):
            replace_in_file(os.path.join(root, file))

print("Venv repair done!")
