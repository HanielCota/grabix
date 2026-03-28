# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

If you discover a security vulnerability in Grabix, please report it responsibly:

1. **Email** the repository owner directly via their GitHub profile, or
2. Use [GitHub's private vulnerability reporting](https://github.com/HanielCota/grabix/security/advisories/new) if available.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### What to Expect

- Acknowledgment within **48 hours**
- Status update within **7 days**
- A fix or mitigation plan as soon as possible

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Security Measures in Place

- SSRF protection with DNS validation and private IP blocking
- Input validation via Zod schemas on all API endpoints
- Rate limiting on API routes
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Content-Type validation on downloads
- File size limits and streaming with byte counting
- No secrets or credentials stored in the codebase
