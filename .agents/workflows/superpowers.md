---
description: Leverage advanced hidden agent capabilities and tooling
---

# Superpowers

This workflow outlines how to maximize the agent's advanced capabilities that go beyond standard file editing.

1.  **Artifact Mastery**: Use Carousels (`carousel` language block), Mermaid diagrams (`mermaid` block), and Alert blocks (`> [!WARNING]`) inside artifacts to provide rich, visual UIs for the user.
2.  **Concurrency**: The agent can run multiple terminal commands asynchronously via `run_command` in the background (putting them in async mode) to massive speed up tasks like installing dependencies while modifying files.
3.  **Subagents**: If a task requires heavy browsing or scraping, remember that a `browser_subagent` can be invoked to navigate the web autonomously, take screenshots, and extract data, returning only the final report to you.
4.  **Turbo Execution**: Use the `// turbo` and `// turbo-all` comments in workflows to bypass user-approval steps for completely safe, standard tasks (like `mkdir` or `ls`), radically speeding up execution time.
