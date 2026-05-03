---
description: Maintain and update the project's central rules and instructions
---

# Project Rules Rules Management (CLAUDE.md Alternative)

This workflow helps you maintain the central instructions for the agent working in this repository.

1.  **Identify Global Instructions**: Whenever the user explicitly establishes a pattern (e.g., "Always use Tailwind for styling", "Never use 'any' in TypeScript"), it needs to be codified.
2.  **Locate the Rules File**: Check if `.agents/rules.md` or a central `RULES.md` exists. If not, create it.
3.  **Categorize the Rule**:
    - **Tech Stack Rules**: Enforce specific versions, libraries, or paradigms.
    - **Formatting Rules**: Enforce naming conventions, file structures, or quote styles.
    - **Workflow Rules**: Enforce steps like "always run tests before committing".
4.  **Update the File**: Use `replace_file_content` to append or modify the rule clearly.
5.  **Apply Retrospectively**: If applicable, do a quick `grep_search` to see if existing code severely violates the newly established rule.
