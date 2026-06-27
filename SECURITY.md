# Security Policy

## Reporting a Vulnerability
Please do not open public issues for security problems. Report privately to the maintainer and allow reasonable time for a fix before disclosure.

## Secret hygiene
This is a clean release snapshot. It must not contain keys, tokens, emails, org IDs, private paths, or runtime state. Before publishing, history is scanned with gitleaks and trufflehog and must be clean.
