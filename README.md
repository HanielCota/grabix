# Grabix

[![CI](https://github.com/HanielCota/grabix/actions/workflows/ci.yml/badge.svg)](https://github.com/HanielCota/grabix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4)](https://tailwindcss.com/)

Open-source media extractor for public web pages. Paste a URL, Grabix analyzes the HTML and finds all public images and videos. Download individually or as a ZIP.

## Stack

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 16 (App Router) | Framework |
| React | 19 | UI |
| TypeScript | 6 | Type safety |
| Tailwind CSS | 4 | Styling |
| Biome | 2.4 | Lint and formatting |
| Zod | 4 | Schema validation |
| Cheerio | 1.2 | HTML parsing |
| Archiver | 7 | ZIP streaming |
| Motion | 12 | Animations |
| Lucide React | 1.7 | Icons |

## Requirements

- [Node.js](https://nodejs.org/) >= 20.0.0
- [npm](https://www.npmjs.com/)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/HanielCota/grabix.git
cd grabix

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Check code with Biome |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Biome |

## Project Structure

```
src/
  app/                          # Next.js App Router
    api/analyze/                # POST - analyze page and return media
    api/download/               # GET - individual download with validation
    api/download-zip/           # POST - batch ZIP download via streaming
  features/media-downloader/
    components/                 # React components (client-side)
    application/                # Use cases (analyze, download, zip)
    domain/                     # Types, Zod schemas, extensions, errors
    infrastructure/             # HTTP fetcher, media extractor (cheerio)
  server/                       # Central config, security, API utilities
```

## Architecture

- **Feature-based structure**: media-downloader code grouped by functionality, not file type
- **Domain separated from infrastructure**: types and business rules don't depend on external libraries
- **Security as a cross-cutting concern**: URL validation and anti-SSRF applied on all endpoints
- **Streaming ZIP**: archiver generates ZIP incrementally without loading everything in memory

## Security

- HTTP/HTTPS only
- Blocked: localhost, 127.0.0.1, 0.0.0.0, private networks
- DNS validation to prevent SSRF (DNS rebinding)
- URL and domain revalidation on every download
- Content-Type, file size, and quantity limits
- Rate limiting on API routes
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Input validation via Zod on all API endpoints

## Configuration

Limits and timeouts are in `src/server/config.ts`:

| Parameter | Default | Description |
|---|---|---|
| `fetchTimeoutMs` | 15s | HTTP request timeout |
| `maxHtmlSizeBytes` | 10 MB | Maximum HTML size |
| `maxAssets` | 200 | Maximum media per analysis |
| `maxFileSizeBytes` | 100 MB | Maximum file size |
| `maxConcurrentDownloads` | 5 | Simultaneous ZIP downloads |

## Lint and Formatting

This project uses [Biome](https://biomejs.dev/) for both linting and formatting. There is no ESLint or Prettier.

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format
```

Biome configuration is in `biome.json`.

## Customization Points

- **Config**: `src/server/config.ts` for limits, timeouts
- **Styles**: `src/app/globals.css` for CSS variables and theme
- **Security**: `src/server/security.ts` for URL validation rules
- **Media types**: `src/features/media-downloader/domain/media-extensions.ts` for supported formats
- **Schemas**: `src/features/media-downloader/domain/types.ts` for API validation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, workflow, and guidelines.

## Branch Strategy

- `main` is the production branch
- Feature branches: `feat/`, `fix/`, `docs/`, `chore/`
- PRs are merged via **squash merge**
- Branches are auto-deleted after merge

## Versioning

This project follows [Semantic Versioning](https://semver.org/). See [CHANGELOG.md](CHANGELOG.md) for release history.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting instructions.

## License

[MIT](LICENSE)

## Roadmap

- [ ] JavaScript rendering (Puppeteer/Playwright) for SPAs
- [ ] More HTML selectors (`picture`, `og:image`, etc.)
- [ ] Async queue for heavy analyses
- [ ] Result persistence (database)
- [ ] Session/user analysis history
- [ ] Authentication and access control
- [ ] Temporary storage (S3/R2) for result caching
- [ ] Structured logging and observability
- [ ] Rate limiting per IP/user with Redis
- [ ] Environment variable configuration
