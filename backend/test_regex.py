import re
history_text = """
--- PREVIOUS CONVERSATION HISTORY ---
[User]: Hello
my name is John
[Assistant]: Hi John
[User]: I want a cafe
-------------------------------------
"""
user_blocks = re.findall(r"\[user\]:([\s\S]*?)(?=\[assistant\]:|\[user\]:|-{5,}|$)", history_text.lower())
print(user_blocks)
