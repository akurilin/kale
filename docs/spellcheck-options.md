# Spellcheck Options for CodeMirror in Kale

Date: 2026-03-05

## Goal

Add a very basic spell checker to the Markdown editor so obvious misspellings are highlighted immediately while writing.

## Current State in Kale

- The CodeMirror editor instance is created in `src/renderer/MarkdownEditorPane.tsx`.
- CodeMirror 6 sets the editable content attributes with `spellcheck: "false"` by default, so browser-native misspelling underlines are currently disabled unless explicitly overridden.
- Electron `BrowserWindow` is created in `src/main/window.ts` and currently does not explicitly set `webPreferences.spellcheck` (Electron default is enabled).

## Option 1: Native Chromium/Electron Spellcheck (Recommended MVP)

### What it is

Enable browser-native spellcheck directly on the CodeMirror editable element via:

- `EditorView.contentAttributes.of({ spellcheck: "true" })`

### Why this option

- Smallest implementation surface.
- Immediate misspelling underlines with no backend service.
- Fits the request for a very basic, immediate highlight pass.

### Pros

- Very fast to implement.
- No custom dictionary plumbing required.
- Uses platform/runtime language dictionaries and suggestion UI.

### Cons

- Limited control over false positives in Markdown-heavy text.
- Styling and behavior are mostly browser-controlled.
- Harder to ignore specific syntax fragments than with a custom linter.

### Estimated effort

- Engineering: low (single short change plus QA pass).

## Option 2: CodeMirror Lint-Based Spell Diagnostics

### What it is

Use `@codemirror/lint` to run a spell-check pass and emit diagnostics/mark decorations for misspelled words.

### Why this option

- Provides precise control over what gets checked (for example, skip code spans, links, URLs, and comment markers).
- Consistent rendering and behavior in the editor.

### Pros

- Full control over matching/tokenization rules.
- Customizable styling and messaging.
- Easier to add domain dictionary/ignore-word support.

### Cons

- More code and maintenance than native spellcheck.
- Requires dictionary integration and debounce/perf work.

### Estimated effort

- Engineering: medium.

## Option 3: Electron Custom Spell Provider

### What it is

Use Electron spellchecker APIs (for example custom provider hooks) to decide misspellings and suggestions.

### Why this option

- Useful when native dictionaries are not enough and app-specific suggestion behavior is required.

### Pros

- Centralized control over suggestion quality and custom dictionary logic.
- Can integrate with domain-specific word lists.

### Cons

- Main/preload/renderer plumbing complexity.
- Higher operational and testing burden than Option 1.

### Estimated effort

- Engineering: medium-high.

## Option 4: External Grammar/Spell API (e.g. LanguageTool)

### What it is

Debounced editor text checks against an external or self-hosted service, rendered via CodeMirror diagnostics.

### Why this option

- Stronger overall language feedback than simple dictionary matching.

### Pros

- Higher-quality suggestions for real prose.
- Can combine spelling and grammar signals.

### Cons

- Network, privacy, and latency concerns.
- More infrastructure than needed for a basic first version.

### Estimated effort

- Engineering: high.

## Recommended Rollout Plan

1. Implement Option 1 as an MVP:
   - add `EditorView.contentAttributes` override to set `spellcheck: "true"`.
2. Run a targeted QA pass on Markdown-heavy content:
   - links, autolinks, inline code, headings, quote blocks, inline comment markers.
3. Decide based on signal quality:
   - if false positives are acceptable, keep Option 1.
   - if noisy, move to Option 2 and add markdown-aware filtering.

## QA Checklist for MVP

- Misspellings in normal prose are underlined.
- Underlines appear while typing and after autosave/debounce cycles.
- Existing live-preview rendering remains intact.
- Inline comment highlighting remains intact.
- No regression in typing performance on long documents.

## Source Links

- CodeMirror `contentAttributes` facet:
  - https://codemirror.net/docs/ref/#view.EditorView%5EcontentAttributes
- CodeMirror lint APIs:
  - https://codemirror.net/docs/ref/#lint
- Electron BrowserWindow API (`webPreferences.spellcheck`):
  - https://www.electronjs.org/docs/latest/api/browser-window
- Electron spellchecker tutorial:
  - https://www.electronjs.org/docs/latest/tutorial/spellchecker
- Electron `webFrame` API (`setSpellCheckProvider`):
  - https://www.electronjs.org/docs/latest/api/web-frame
- LanguageTool API:
  - https://languagetool.org/http-api/swagger-ui/
