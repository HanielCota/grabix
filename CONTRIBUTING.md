# Contributing to Grabix

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Git](https://git-scm.com/)

### Setup

1. **Fork** the repository on GitHub.

2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/YOUR_USERNAME/grabix.git
   cd grabix
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

4. **Start the development server:**

   ```bash
   npm run dev
   ```

5. **Open** [http://localhost:3000](http://localhost:3000) to verify everything works.

## Development Workflow

### Branch Strategy

- `main` is the production branch. Never push directly to it.
- Create feature branches from `main` using descriptive names:
  - `feat/add-pdf-support`
  - `fix/download-timeout`
  - `docs/update-readme`

### Before Submitting

Run all checks locally:

```bash
# Lint
npm run lint

# Fix lint issues automatically
npm run lint:fix

# Format code
npm run format

# Build (must pass)
npm run build
```

### Commit Conventions

Use clear, descriptive commit messages. We recommend [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add PDF media support
fix: resolve timeout on large pages
docs: update installation instructions
refactor: simplify URL validation logic
chore: update dependencies
```

### Opening a Pull Request

1. Push your branch to your fork.
2. Open a PR against `main` on the upstream repository.
3. Fill out the PR template completely.
4. Ensure CI checks pass.
5. Wait for at least one approval before merging.

PRs are merged via **squash merge** to keep the history clean.

## Opening Issues

### Bug Reports

- Use the **Bug Report** issue template.
- Include steps to reproduce, expected vs actual behavior, and environment details.
- Attach screenshots or logs when relevant.

### Feature Requests

- Use the **Feature Request** issue template.
- Describe the problem you're trying to solve, not just the solution.
- Consider alternatives and trade-offs.

## Quality Checklist

Before submitting a PR, verify:

- [ ] Code follows the project's existing style
- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` succeeds
- [ ] Changes are minimal and focused
- [ ] No unrelated changes are included
- [ ] PR description explains the "why"

## Questions?

If something is unclear, open a [Discussion](https://github.com/HanielCota/grabix/discussions) or check `SUPPORT.md`.
