---
description: Automated setup of Git hooks for linting, testing, and formatting
---

# Hookify Workflow

This workflow automates repository quality control by setting up Git hooks (like pre-commit).

1.  **Check Existing Hooks**: Determine if tools like `husky` (Node) or `pre-commit` (Python) are already installed.
2.  **Install Hook Manager**:
    - **Node/JS**: Run `npm install --save-dev husky` and `npx husky init`.
    - **Python**: Run `pip install pre-commit` and create a `.pre-commit-config.yaml` file.
3.  **Configure Quality Tools**:
    - Ensure linters (ESLint, Flake8), formatters (Prettier, Black), and tests (Jest, PyTest) are configured in the project.
4.  **Wire Hooks**:
    - Add the lint/format commands to the pre-commit hook file.
    - Add the test commands to the pre-push hook file.
5.  **Verify**: Trigger a mock commit to ensure the hooks execute correctly and block bad commits.
