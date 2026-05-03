---
description: Standardize and prepare the agentic workspace for optimal autonomous work
---

# Agent Workspace Setup

This workflow ensures the repository is perfectly tailored for agentic assistance.

1.  **Directory Structure**: Ensure `.agents/workflows/` and `.agents/skills/` directories exist for extensibility.
2.  **Artifact Pre-flight**: Ensure `task.md`, `implementation_plan.md`, and `walkthrough.md` artifacts exist to track state, progress, and history. If they don't exist, create them.
3.  **Environment Check**: Verify that `.env.example` exists so the agent knows what environment variables are required without needing access to actual secrets.
4.  **Dependency Validation**:
    - Ensure package lockfiles (`package-lock.json`, `poetry.lock`) are present to guarantee deterministic installs.
    - Run an initial environment check (e.g., `npm run build` or `python -m pytest`) to ensure the baseline is functional before the agent starts modifying things.
