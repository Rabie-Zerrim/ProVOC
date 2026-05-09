# Contributing to ProVOC BFF

## Branch Rules

| Branch | Purpose |
|--------|---------|
| `master` | Production-ready code only. Never commit directly to this branch. |
| `dev` | Active development branch. All work goes here first. |

## Workflow

1. All development work happens on `dev`.
2. `master` is only updated when a deliverable is fully tested and working.
3. To promote `dev` to `master`:

```bash
git checkout master
git merge dev
git checkout dev
```

## Feature Branches

When working on a specific feature or ticket, branch off `dev`:

```bash
git checkout dev
git checkout -b feature/my-feature
# ... work ...
git checkout dev
git merge feature/my-feature
```

## Commit Messages

Use clear, descriptive commit messages following this pattern:

```
type: short description

- Detail 1
- Detail 2
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
