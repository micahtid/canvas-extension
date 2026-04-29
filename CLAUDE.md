# CustomCanvas — Project Instructions

This is a Chrome MV3 extension (Vite + vanilla JS/CSS) that customizes the
Canvas LMS UI for `canvas.unl.edu`. Source lives in `src/`, build output in `dist/`.

## Mandatory rule: keep CHANGELOG.md current

**Any time you modify Canvas's appearance or behavior — add custom UI, restyle
an existing region, change selectors, add/remove a feature, or revert
something — you MUST update `CHANGELOG.md` in the same response, before
considering the task complete.**

This applies to changes in:
- `src/content.js` (DOM injection, API calls, observers, feature logic)
- `src/content.css` (any rule targeting Canvas selectors or our custom widgets)
- `manifest.json` (permissions, host matches, content script declarations)

It does NOT apply to:
- Build config tweaks (`vite.config.js`, `package.json`) that don't change runtime behavior
- Pure refactors that leave the user-visible result identical
- Edits to `CHANGELOG.md` itself or other docs

### How to update the changelog

1. Find or create today's date section (`## YYYY-MM-DD`).
2. Add an entry with three parts:
   - **Where:** the Canvas DOM region or selector(s) affected
   - **What:** the specific change and the selectors/files touched
   - **Why** (optional): the reasoning, if it's not obvious from the diff
3. If you revert a previous change, do NOT delete its original entry. Tag the
   original `(REVERTED)` and add a new entry explaining what replaced it.
4. Keep entries terse but specific enough that someone can locate the relevant
   code from the entry alone.

### Reminder

If you finish a change and realize you forgot to update `CHANGELOG.md`, stop
and update it before responding to the user. Treat the changelog as part of
the change, not as documentation written after the fact.

## Build workflow

After any edit to `src/` or `manifest.json`, run `npm run build` to refresh
`dist/` (the user loads the unpacked extension from `dist/`). Don't ask — just
build.
