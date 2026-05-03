---
description: Create a new specialized Skill for the AI agent
---

# Skill Creator Workflow

This workflow is designed to help you create a new specialized Skill to extend the agent's capabilities for a specific domain.

1.  **Identify the Need**: Determine what specialized task the AI needs to perform (e.g., "deploying to AWS", "writing complex SQL queries", "configuring Webpack").
2.  **Define the Skill Document**: Create a new Markdown file in `.agents/skills/[skill-name]/SKILL.md`.
3.  **Add Frontmatter**: Include YAML frontmatter at the top of `SKILL.md` with:
    ```yaml
    ---
    name: [Skill Name]
    description: [Brief description of what the skill does]
    ---
    ```
4.  **Write Clear Instructions**: Inside `SKILL.md`, define:
    - **Context**: When to use this skill.
    - **Prerequisites**: What tools or credentials are required.
    - **Step-by-Step Guide**: Exact rules, patterns, and steps the agent must follow.
    - **Anti-patterns**: What *not* to do.
5.  **Create Helper Scripts (Optional)**: If the skill requires complex automation, create python or bash scripts in `.agents/skills/[skill-name]/scripts/` and reference them in the `SKILL.md`.

// turbo
6. Add the new directory structure: `mkdir -p .agents/skills/[skill-name]/scripts`
