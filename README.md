<div align="center">

<br />

<img src="public/grabix-logo.svg" alt="Grabix" width="80" />

# Grabix

**Extract public media from any web page.**<br />
Paste a URL. Grabix scans the HTML and pulls every image and video it finds.<br />
Download one by one or grab everything as a ZIP.

<br />

[![CI](https://github.com/HanielCota/grabix/actions/workflows/ci.yml/badge.svg)](https://github.com/HanielCota/grabix/actions/workflows/ci.yml)
&nbsp;
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
&nbsp;
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
&nbsp;
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
&nbsp;
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
&nbsp;
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
&nbsp;
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

<br />

</div>

---

<br />

## Overview

Grabix is an open-source web app that extracts publicly available media from any web page. It works entirely from the HTML source, without executing JavaScript or bypassing authentication.

**How it works:**

```
URL  ->  fetch HTML  ->  parse with Cheerio  ->  extract media refs  ->  display gallery  ->  download
```

**What it supports:**

- Images: `jpg` `jpeg` `png` `webp` `gif` `svg`
- Videos: `mp4` `webm` `mov` `m4v`
- Lazy-load attributes: `data-src`, `data-lazy-src`, `data-original`, `data-bg`, `srcset` variants
- Noscript fallback images
- Links (`<a href>`) pointing to media files

<br />

## Tech Stack

<table>
<tr>
<td width="50%">

**Frontend**
| | Tech | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16 |
| UI Library | React | 19 |
| Language | TypeScript | 6 |
| Styling | Tailwind CSS | 4 |
| Animations | Motion | 12 |
| Icons | Lucide React | 1.7 |

</td>
<td width="50%">

**Backend & Tooling**
| | Tech | Version |
|---|---|---|
| Validation | Zod | 4 |
| HTML Parser | Cheerio | 1.2 |
| ZIP Streaming | Archiver | 7 |
| Linter / Formatter | Biome | 2.4 |
| Runtime | Node.js | >= 20 |

</td>
</tr>
</table>

<br />

## Quick Start

```bash
git clone https://github.com/HanielCota/grabix.git
cd grabix
npm install
npm run dev
```

Open **http://localhost:3000** and paste any public URL.

<br />

## Available Scripts

```bash
npm run dev          # start dev server
npm run build        # production build
npm start            # start production server
npm run lint         # check code with Biome
npm run lint:fix     # auto-fix lint issues
npm run format       # format code with Biome
```

<br />

## Project Structure

```
grabix/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── api/
│   │   │   ├── analyze/route.ts          # POST  - analyze page, return media list
│   │   │   ├── download/route.ts         # GET   - download single file
│   │   │   └── download-zip/route.ts     # POST  - download batch as ZIP
│   │   ├── layout.tsx                    # root layout
│   │   ├── page.tsx                      # homepage
│   │   ├── error.tsx                     # error boundary (global)
│   │   ├── not-found.tsx                 # 404 page
│   │   └── globals.css                   # theme + CSS variables
│   │
│   ├── features/media-downloader/
│   │   ├── components/                   # React UI (client-side)
│   │   │   ├── media-downloader.tsx      # main container
│   │   │   ├── media-gallery.tsx         # results grid + stats
│   │   │   ├── media-card.tsx            # individual media card
│   │   │   ├── media-filters.tsx         # image/video filter tabs
│   │   │   ├── url-input.tsx             # URL input form
│   │   │   └── error-message.tsx         # error alert
│   │   ├── application/                  # use cases
│   │   │   ├── analyze-page.ts           # orchestrates analysis
│   │   │   ├── download-asset.ts         # single file download
│   │   │   └── download-zip.ts           # ZIP stream generation
│   │   ├── domain/                       # types, schemas, rules
│   │   │   ├── types.ts                  # interfaces + Zod schemas
│   │   │   ├── errors.ts                 # AppError + error factories
│   │   │   └── media-extensions.ts       # allowed formats
│   │   └── infrastructure/               # external integrations
│   │       ├── html-fetcher.ts           # fetch + validate HTML
│   │       └── media-extractor.ts        # Cheerio parsing
│   │
│   ├── server/                           # shared server utilities
│   │   ├── config.ts                     # limits, timeouts
│   │   ├── security.ts                   # SSRF protection, DNS validation
│   │   └── api-utils.ts                  # error handler
│   │
│   └── proxy.ts                          # rate limiting + method enforcement
│
├── biome.json                            # Biome config
├── next.config.ts                        # Next.js config + security headers
├── tsconfig.json
├── postcss.config.mjs
└── package.json
```

<br />

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Client (React 19)                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ UrlInput │→ │ Downloader│→ │ Gallery  │→ │ MediaCard│       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└────────────────────────┬────────────────────────────────────────┘
                         │ fetch
┌────────────────────────▼────────────────────────────────────────┐
│  Proxy (rate limit, method enforcement)                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  API Routes                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ /api/analyze  │  │ /api/download│  │/api/download │          │
│  │   (POST)      │  │   (GET)      │  │   -zip (POST)│          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│  ┌──────▼─────────────────▼──────────────────▼───────┐          │
│  │  Zod Schema Validation                            │          │
│  └──────┬─────────────────┬──────────────────┬───────┘          │
│         │                 │                  │                   │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐          │
│  │ Security     │  │ Security     │  │ Security     │          │
│  │ (SSRF + DNS) │  │ (SSRF + DNS) │  │ (SSRF + DNS) │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐          │
│  │ Cheerio      │  │ Stream       │  │ Archiver     │          │
│  │ HTML Parse   │  │ + Size Limit │  │ ZIP Stream   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

**Design decisions:**

- **Feature-based** - all media-downloader code lives together, not scattered by file type
- **Domain isolation** - types and business rules have zero external dependencies
- **Security by default** - SSRF protection, DNS validation, and input validation on every endpoint
- **Streaming** - ZIP is generated incrementally, never buffered in memory

<br />

## Security

<table>
<tr><td>SSRF Protection</td><td>Private IPs, localhost, and link-local addresses are blocked. DNS is validated before every request to prevent rebinding.</td></tr>
<tr><td>Input Validation</td><td>All API inputs go through Zod schemas. File names are checked for path traversal. Extensions are validated against an allowlist.</td></tr>
<tr><td>Rate Limiting</td><td>30 requests/min per IP on all API routes via proxy middleware.</td></tr>
<tr><td>Security Headers</td><td>CSP, X-Frame-Options (DENY), X-Content-Type-Options, Referrer-Policy, Permissions-Policy.</td></tr>
<tr><td>Download Safety</td><td>Content-Type validation, file size limits (100 MB), byte-counting stream wrapper.</td></tr>
<tr><td>Protocol</td><td>Only HTTP and HTTPS. No <code>file://</code>, <code>ftp://</code>, or other schemes.</td></tr>
</table>

<br />

## Configuration

All limits live in **`src/server/config.ts`** for easy tuning:

```typescript
export const appConfig: AppConfig = {
  limits: {
    fetchTimeoutMs: 15_000,            // 15s per request
    maxHtmlSizeBytes: 10 * 1024 * 1024, // 10 MB max HTML
    maxAssets: 200,                     // max media per analysis
    maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB per file
    maxConcurrentDownloads: 5,          // parallel downloads in ZIP
  },
};
```

**Other customization points:**

| What | Where |
|---|---|
| Theme / CSS variables | `src/app/globals.css` |
| Security rules | `src/server/security.ts` |
| Supported media formats | `src/features/media-downloader/domain/media-extensions.ts` |
| API validation schemas | `src/features/media-downloader/domain/types.ts` |
| Rate limit settings | `src/proxy.ts` |

<br />

## Lint & Formatting

Grabix uses [**Biome**](https://biomejs.dev/) for both linting and formatting. No ESLint, no Prettier.

```bash
npm run lint         # check
npm run lint:fix     # auto-fix
npm run format       # format
```

Key rules: `noUnusedImports`, `noUnusedVariables`, `useImportType`, `useConst` as errors. Organized imports on save. Config in `biome.json`.

<br />

## Contributing

We welcome contributions! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide.

**Quick version:**

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/grabix.git
cd grabix && npm install

# 2. Create a branch
git checkout -b feat/your-feature

# 3. Make changes, then validate
npm run lint && npm run build

# 4. Commit & push
git commit -m "feat: your feature description"
git push origin feat/your-feature

# 5. Open a PR against main
```

**Branch naming:** `feat/`, `fix/`, `docs/`, `chore/`<br />
**Merge strategy:** squash merge, branches auto-deleted after merge<br />
**Commits:** [Conventional Commits](https://www.conventionalcommits.org/)

<br />

## Versioning

This project follows [Semantic Versioning](https://semver.org/). See **[CHANGELOG.md](CHANGELOG.md)** for release history.

<br />

## Security Reports

**Do not open public issues for vulnerabilities.** See **[SECURITY.md](SECURITY.md)** for responsible disclosure instructions.

<br />

## Roadmap

- [ ] JavaScript rendering (Puppeteer/Playwright) for SPAs
- [ ] Additional selectors (`<picture>`, `og:image`, CSS backgrounds)
- [ ] Async queue for heavy analyses
- [ ] Result persistence with database
- [ ] User session and analysis history
- [ ] Authentication and access control
- [ ] Temporary storage (S3/R2) for caching
- [ ] Structured logging and observability
- [ ] Redis-backed rate limiting
- [ ] Environment variable configuration

<br />

## License

[MIT](LICENSE) &copy; [HanielCota](https://github.com/HanielCota)

<div align="center">
<br />
<sub>Built with Next.js, React, TypeScript, and Tailwind CSS.</sub>
<br />
<br />
</div>
