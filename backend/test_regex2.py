import re
_NEW_CONSULTATION_PATTERNS = [
    r"\b(need|get|apply for|obtain) (a |an )?(permit|ruhsat|lisans|licence|license) (for|to)\b",
    r"\b(enroll|register|apply) (at|for|to|in) (a |the |my )?university\b",
    r"\b(form|create|register|incorporate|set up) (a |my |an )?(company|business|firm|ltd|aş)\b",
    r"\b(i need|i have|i got) (a |an )?(legal|contract|lawyer|employment) (problem|issue|dispute|case|question|matter)\b",
    r"^(i want to obtain a business permit)$",
    r"^(i want to know the steps)$",
    r"^(how to get a work permit\??)$",
    r"^(contract review|company formation|employment law|legal disputes|legal timelines|residency/permit|residency permit)$",
    r"\b(review (my |a |the )?(contract|agreement|nda|clause)|check (my |this )?(contract|agreement))\b",
    r"\b(form|open|start|register|incorporate) (a |my )?(company|ltd|limited şirket|anonim şirket|business|firm)\b",
    r"\b(fired|wrongfully dismissed|unfair dismissal|severance pay|kıdem tazminat|employment dispute|labour court|iş mahkemesi)\b",
    r"\b(work permit|residence permit|ikamet (başvuru|application)|çalışma izni|stay in turkey legally|legal to work)\b",
    r"\b(legal dispute|lawsuit|mediation|arabuluculuk|ihtarname|file a claim|take to court|sue (someone|my|the))\b",
    r"\b(how long (does|will|do)).{0,40}(company|permit|contract|court|case|formation|residency|ikamet)\b",
    r"\b(cafe|kafe|restaurant|restoran|retail|office|ofis|pharmacy|eczane|bakery|f[ıi]r[ıi]n|barber|berber|gym|spor|shop|store|company|ma[\u011fg]aza|d[üu]kkan) (in|at) \b",
    r"\b(renew|replace).{1,15}(id|kimlik|student id)\b",
]
_NEW_CONSULTATION_RE = re.compile("|".join(_NEW_CONSULTATION_PATTERNS), flags=re.IGNORECASE)
print(_NEW_CONSULTATION_RE.search("hello how are you"))
