---
description: Gather and manage context efficiently tracking active files and project state
---

# Context Management (Context7 Alternative)

This workflow helps optimize how the agent understands the project state without blowing up the context window.

1.  **Establish Baseline**: 
    - Read `package.json` / `requirements.txt` to understand the tech stack.
    - Read the `README.md` if available.
2.  **Targeted Search**:
    - Use `find_by_name` to locate specific file types or components rather than blindly listing directories.
    - Use `grep_search` to find exact usage of functions, classes, or specific text references.
3.  **Intelligent Reading**:
    - Only `view_file` on files directly related to the current objective. 
    - Close or ignore files that are no longer relevant.
4.  **Knowledge Items (KIs) Review**:
    - Always check the `KNOWLEDGE SUBAGENT` KIs or `task.md` / `walkthrough.md` artifacts to review previously established context before starting a new task.
