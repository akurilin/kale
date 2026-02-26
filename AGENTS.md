- !IMPORTANT: do not commit unless explitictly told to by the user
- It is currently year 2026, assume that when searching for documentation

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

## GitHub Tooling

- The agent can use the `gh` tool to interact with GitHub in general.

# QA / Testing / Manually exercising the app

- The app can only be driven via CDP (Playwright as a Node Library). Use this approach when you
  need o programmatically interact with the running Electron app — clicking, typing, reading content, etc.
  Screenshots are handled by another script. You must manually write node js code and execute it in order to
  drive the app since MCP will not work.
- Never use Playwright MCP to test or drive the app — it runs its own isolated browser and cannot
  connect to the Electron process. See "Driving the App via CDP" below for the correct approach.
- For quick visual verification, use `scripts/capture_npm_start_window.sh` to screenshot an
  already-running `kale` window. Kill the app process after you're done verifying.
- After finishing a batch of changes, run `npm run format` and `npm run lint` before wrapping up

### Why not Playwright MCP?

The Playwright MCP server launches its **own** browser instance and only allows `http:`/`https:` URLs.
The Electron app serves from a `file://` URL and is already running as a separate process.
You must use Playwright as a **Node.js library** via `node -e` (Bash tool), not the MCP tool.

### Step 1: Launch the app with CDP

```bash
scripts/start-with-cdp.sh
```

This builds the app, launches Electron with `--remote-debugging-port=9222`, and waits until CDP
is ready. Use `--skip-build` to reuse a previous build.

**Agent default:** Prefer a fresh build (`scripts/start-with-cdp.sh` without `--skip-build`) for
CDP automation runs. Only use `--skip-build` when reusing a build you just created and validated
in the same session. A stale `.vite/build` can point at a Vite dev server URL (for example
`http://localhost:5173`) and cause the Electron window to fail to load.

**No manual cleanup needed:** The script automatically kills any existing Electron/CDP instance
on the same port before launching, so you never need to `pkill` beforehand.

**Codex/agent execution quirk:** In managed shell execution environments (including Codex),
background processes may be terminated when the launching command session exits. Do not run
`scripts/start-with-cdp.sh` as a one-shot command and then let that shell session end before
connecting Playwright. Launch it in a persistent PTY session and keep that session alive until
the CDP-driven interaction is complete (for example, by tailing `/tmp/kale-cdp.log`).

After launching, wait **5 seconds** for the UI to fully render before connecting with Playwright
(this machine is fast enough that 5 s is plenty).

### Step 2: Connect and get the app page

```js
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://localhost:9222');
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

Always close the browser connection and kill the Electron process when done:

```js
await browser.close();
```

```bash
pkill -f 'Electron .vite'
```

### Complete example (single `node -e` invocation)

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
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
