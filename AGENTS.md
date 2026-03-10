# Kale

- !IMPORTANT: do not commit unless explicitly told to by the user
- It is currently year 2026, assume that when searching for documentation

## Commands

- Start dev: `npm start`
- Run unit tests: `npm test`
- Run E2E tests: `npm run test:e2e`
- Lint: `npm run lint`
- Format: `npm run format`
- Typecheck: `npm run typecheck`
- Shellcheck: `npm run shellcheck`
- Static validation pass: `npm run validate:static`

## Development Methodology

Follow a spec-driven, BDD-style development approach:

1. **Spec first**: before implementing new functionality, write the test suite that describes the expected behavior. This applies to both unit tests (Vitest) and E2E scenarios (Playwright). Define what the feature should do before writing the code that does it.
2. **API design through tests**: writing tests first forces deliberate decisions about function signatures, module boundaries, and data flow. Use this as a design tool, not just a verification step.
3. **Red-green-refactor**: write a failing test, make it pass with the simplest implementation, then refactor. Don't skip steps.
4. **Test placement**:
   - Unit tests: colocated with source files as `<module>.test.ts` (e.g. `src/renderer/line-merge.test.ts`)
   - E2E scenarios: `tests/e2e/scenarios/<name>.scenario.js`
5. **Be judicious about what gets tested**: focus tests on code where bugs would be subtle and hard to trace — parsing, data transformations, merge logic, algorithmic code, state machines. Skip tests for things where bugs are immediately obvious — CSS/styling, static config, thin wiring/glue code, one-liners, framework boilerplate, and anything TypeScript already enforces. If a test just restates the implementation, it's not adding value.

## Coding style

- Use a self-explanatory naming style that makes it easy to understand what a function does based on the name alone. It's better to make it longer and clearer than to try to be brief and obscure.
- Comment every function with a header comment focusing on the why
- Add comments to sections that may be not obvious to future readers, focus on WHY something is implemented and implemented that particular way
- Preserve comments when copying code around and refactoring
- Keep comments updated as you're changing the logic, make sure they still reflect what's happening in the logic

## Documentation Policy

- `README.md` is the source of truth about this project.
- The agent must read `README.md` at the beginning of each session.
- The agent must keep `README.md` updated with the latest changes to the repository.
- If you need to understand the architecture of this project, read `ARCHITECTURE.md`.

## GitHub Tooling

- The agent can use the `gh` tool to interact with GitHub in general.

# QA / Testing / Manually exercising the app

- The app can only be driven via CDP (Playwright as a Node Library). Use this approach when you
  need to programmatically interact with the running Electron app — clicking, typing, reading content, etc.
  You must manually write node js code and execute it in order to drive the app since MCP will not work.
- Never use Playwright MCP to test or drive the app — it runs its own isolated browser and cannot
  connect to the Electron process. See "Driving the App via CDP" below for the correct approach.
- For visual verification, use Playwright's `page.screenshot()` after connecting over CDP.
  This works in headless mode (the default) — no visible window is needed.
  If you launched via `scripts/start-with-cdp.sh --instance <id>`, stop by ending that session
  terminal (for example with Ctrl+C), not with global `pkill`.
- After finishing a batch of changes, run `npm run validate:static` before wrapping up

### Why not Playwright MCP?

The Playwright MCP server launches its **own** browser instance and only allows `http:`/`https:` URLs.
The Electron app serves from a `file://` URL and is already running as a separate process.
You must use Playwright as a **Node.js library** via `node -e` (Bash tool), not the MCP tool.

### Step 1: Launch the app with CDP

```bash
scripts/start-with-cdp.sh --instance <instance-id> --json
```

`--instance` is mandatory. The script fails if it is omitted.
Each instance gets isolated runtime state under `/tmp/kale-qa/<instance-id>/`
(`user-data`, `session.md`, logs, and `session.json` metadata).

The script runs **headless by default** (no visible window). Pass `--no-headless` to
show the Electron window for manual debugging.

`--json` suppresses extra human helper lines.
The machine-readable `KALE_QA_READY {...}` marker line is emitted regardless.

The script runs in the foreground, streams Electron logs to stdout, and emits one
machine-readable readiness line:

```text
KALE_QA_READY {...json...}
```

It also writes the same metadata to:

```text
/tmp/kale-qa/<instance-id>/session.json
```

Use `--skip-build` only when intentionally reusing a build.

**Agent default:** Prefer a fresh build (`scripts/start-with-cdp.sh --instance <id>`) for
CDP automation runs. Only use `--skip-build` when reusing a build you just created and validated
in the same session. A stale `.vite/build` can point at a Vite dev server URL (for example
`http://localhost:5173`) and cause the Electron window to fail to load.

**Codex/agent execution quirk:** In managed shell execution environments (including Codex),
background processes may be terminated when the launching command session exits. Do not run
`scripts/start-with-cdp.sh --instance <id>` as a one-shot command and then let that shell session
end before connecting Playwright. Launch it in a persistent PTY session and keep that session
alive until the CDP-driven interaction is complete.

After launching, wait **5 seconds** for the UI to fully render before connecting with Playwright
(this machine is fast enough that 5 s is plenty).

### Step 2: Connect and get the app page

```js
const fs = require('node:fs');
const { chromium } = require('playwright');
const sessionState = JSON.parse(
  fs.readFileSync('/tmp/kale-qa/<instance-id>/session.json', 'utf8'),
);
const browser = await chromium.connectOverCDP(sessionState.cdpUrl);
const pages = browser.contexts()[0].pages();
const page = pages.find(p => !p.url().startsWith('devtools://'));
```

The CDP endpoint exposes multiple pages (including DevTools). Filter for the app page by
excluding `devtools://` URLs.

### Step 3: Interact with the CodeMirror Markdown editor

The editor uses CodeMirror 6. Key selectors:

- `.cm-editor` — the outer editor wrapper
- `.cm-content` — the editable content area (`contentEditable="true"`)

**Reading editor content:**

```js
const text = await page.evaluate(() => {
  return document.querySelector('.cm-content')?.innerText;
});
```

**Typing into the editor (simulates real user input):**

```js
// Focus the editor
await page.click('.cm-content');

// Move cursor to end of document (macOS)
await page.keyboard.press('Meta+ArrowDown');

// Add a new paragraph
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('Your new paragraph text here.', { delay: 10 });
```

**Taking a screenshot:**

```js
await page.screenshot({ path: '/tmp/kale-screenshot.jpg', type: 'jpeg', quality: 80 });
```

### Step 4: Wait for autosave and verify

The editor autosaves with a 5-second debounce. After typing, wait at least 6 seconds before
checking the file on disk:

```bash
sleep 6 && tail -5 /path/to/file.md
```

### Step 5: Clean up

Close the browser connection, then end the terminal session running
`scripts/start-with-cdp.sh --instance <id>` (for example with Ctrl+C).
Do not use global `pkill` cleanup.

```js
await browser.close();
```

### Complete example (single `node -e` invocation)

```bash
node -e "
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const sessionState = JSON.parse(
    fs.readFileSync('/tmp/kale-qa/<instance-id>/session.json', 'utf8')
  );
  const browser = await chromium.connectOverCDP(sessionState.cdpUrl);
  const pages = browser.contexts()[0].pages();
  const page = pages.find(p => !p.url().startsWith('devtools://'));

  await page.click('.cm-content');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('New paragraph added by automation.');

  await page.screenshot({ path: '/tmp/kale-screenshot.jpg', type: 'jpeg', quality: 80 });
  await browser.close();
})();
"
```

### Where to create test files

Use /tmp and its sub-folders to create one-off markdown files for QA testing
