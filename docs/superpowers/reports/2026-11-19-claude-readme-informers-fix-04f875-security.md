# Security review: claude/readme-informers-fix-04f875

Date: 2026-11-19
Scope: diff from the merge base with `origin/main` to `HEAD` (7 files, +28/-18).

## Result

No findings.

## What was checked

- `.claude/settings.json`: the new `SessionStart` hook that runs `npm install --no-audit --no-fund`.
- `README.md` and the five translations: badge text and table label edits.
- `package.json`: it has no `preinstall`, `install`, `postinstall` or `prepare` scripts. The repository has no `.npmrc`.

## Dismissed candidates

1. **Command injection in the hook.** The command is a fixed string. The only variable is `$CLAUDE_PROJECT_DIR`, which Claude Code sets. The variable is in double quotes.
2. **Code execution through npm lifecycle scripts.** `npm install` resolves from the committed `package-lock.json`. This is the same code that a manual install runs. An attacker who can change the lockfile already controls the repository. Claude Code asks the user to trust a project before project hooks run.
3. **Freshness check (`-nt`).** A wrong result causes an extra or a skipped install. This is a correctness concern, not a security concern.
4. **README edits.** They change only shields.io badge text and table labels. They add no hosts, links or scripts.
