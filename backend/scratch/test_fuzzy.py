import sys
import os
from difflib import SequenceMatcher

# fuzzy matching logic
stop_words = {
    "what", "when", "where", "which", "know", "take", "long", "tell", "need", 
    "some", "want", "have", "with", "this", "that", "from", "your", "does", "will", 
    "hows", "about", "like", "make", "work", "just", "time", "sure", "right", 
    "correct", "true", "accurate", "help", "good", "great", "perfect"
}

text = "whats docs req"
words = text.split()

smalltalk_pattern = "how are you how do you do hows it going what's up whats up how are things hows life nasılsın naber nasıl gidiyor how are u how r u hw r u hw are u how r uu how are ytou"
pattern_words = smalltalk_pattern.split()

for pw in pattern_words:
    pw = pw.lower()
    if len(pw) < 4 or pw in stop_words: continue
    for tw in words:
        tw = tw.lower()
        if len(tw) < 4 or tw in stop_words: continue
        ratio = SequenceMatcher(None, tw, pw).ratio()
        if ratio > 0.8:
            print(f"Matched '{tw}' with '{pw}', ratio {ratio}")

