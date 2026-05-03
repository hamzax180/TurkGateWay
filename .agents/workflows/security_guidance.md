---
description: Apply security best practices and review code for vulnerabilities
---

# Security Guidance

This workflow ensures that code modifications are secure by default.

1.  **Secret Scrubbing**: 
    - Never hardcode API keys, passwords, or tokens.
    - Ensure all secrets are loaded via environment variables or secure secret managers.
    - Verify that `.env` files and similar sensitive files are explicitly added to `.gitignore`.
2.  **Input Validation**:
    - Ensure all user inputs (from APIs, forms, or headers) are strictly validated and sanitized before processing.
    - Use parameterized queries or ORMs to prevent SQL Injection.
3.  **Dependencies Check**:
    - Check for vulnerable dependencies using `npm audit` or `pip check`.
4.  **Least Privilege**:
    - Ensure services, containers, and scripts run with the minimum permissions necessary.
5.  **Review Pass**: 
    - Before finalizing a task, do a specific visual pass looking for common OWASP Top 10 vulnerabilities (XSS, CSRF, broken access control).
