import os
import re

def replace_in_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Use case-sensitive replacement to preserve capitalization
    content = content.replace('Agent', 'Agent')
    content = content.replace('agent', 'agent')
    content = content.replace('AGENT', 'AGENT')
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

files = [
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\workflow\lawyer_orchestrator.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\workflow\student_orchestrator.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\smart_router\ai_fallback.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\smart_router\rag.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\smart_router\__init__.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\main.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\lawyer\responses.json',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\permit\responses.json',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\student\responses.json',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\student\model.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\lawyer\model.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\student\learned\en.json',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\permit\learned\en.json',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\core_agents.py',
    r'c:\Users\hamza\OneDrive\Desktop\TOP IMPORTANT FOLDER\bcb\backend\agents\general\responses.json',
]

for f in files:
    if os.path.exists(f):
        print(f"Processing {f}...")
        replace_in_file(f)
    else:
        print(f"File not found: {f}")

print("Done!")
