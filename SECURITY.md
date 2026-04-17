# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x-alpha (current) | :white_check_mark: |
| Older alpha builds | :x: |
| Legacy non-alpha lines | :x: |

> Aegis currently ships in the alpha channel only. Legacy version lines are retired and no longer receive security fixes.

## Reporting a Vulnerability

If you discover a security vulnerability in Aegis, please report it responsibly:

1. **Preferred**: Open a [GitHub Security Advisory](https://github.com/OneStepAt4time/aegis/security). This keeps the report private until a fix is released.
2. **Fallback**: Use the [Security Vulnerability issue template](https://github.com/OneStepAt4time/aegis/issues/new?template=security.yml). Maintainers will move it to a private advisory if needed.
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

Security patches are released through the active alpha line. We recommend upgrading to the latest published alpha immediately.
