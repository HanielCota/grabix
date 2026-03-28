# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-28

### Added

- Initial release
- Media extraction from public web pages via HTML analysis
- Support for images (jpg, jpeg, png, webp, gif, svg) and videos (mp4, webm, mov, m4v)
- Individual file download with server-side validation
- Batch ZIP download with streaming
- SSRF protection with DNS validation and private IP blocking
- Rate limiting via proxy middleware
- Security headers (CSP, X-Frame-Options, Referrer-Policy, etc.)
- Zod schema validation on all API inputs
- Responsive UI with Tailwind CSS and Motion animations
- Biome for linting and formatting
- CI workflow with GitHub Actions
- Community files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT)
