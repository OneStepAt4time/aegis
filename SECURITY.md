# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Aegis, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email security vulnerabilities to: **aegis-security@proton.me**
3. Include a description of the vulnerability, steps to reproduce, and potential impact.
4. We will acknowledge receipt within 48 hours and provide a timeline for the fix.

## Security Measures

Aegis implements the following security controls:

- **Authentication**: API key-based auth with optional master token
- **Input validation**: Path traversal prevention, env var name validation
- **SSRF protection**: URL scheme and private IP range validation
- **Command injection prevention**: Port validation, safe exec patterns
- **Transport security**: Recommended behind HTTPS reverse proxy

## Security Updates

Security patches are released as minor/patch versions. We recommend keeping Aegis updated to the latest version.
