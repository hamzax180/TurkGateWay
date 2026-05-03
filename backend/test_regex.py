import re
history_text = """
--- PREVIOUS CONVERSATION HISTORY ---
[User]: no i just want to open in cafe
[Assistant]: Excellent — Café! 👍 Now, to build your full roadmap: Which district of Istanbul are you opening in?
-------------------------------------
"""
user_blocks = re.findall(r"\[user\]:([\s\S]*?)(?=\[assistant\]:|\[user\]:|-{5,}|$)", history_text.lower())
print("USER BLOCKS:", user_blocks)
