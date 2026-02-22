# TODOs

## Deferred issues (not fixing yet)

1. Packaged app save path writes into `app.asar` (`src/main.ts`)
   - Current save/load path is built from `app.getAppPath()`, which resolves inside the packaged application archive when Electron Forge packages with `asar: true`.
   - In packaged installs this makes the target markdown file effectively read-only, so `fs.writeFile` fails and saving breaks.
   - Deferred for now; needs a writable user-data path strategy for packaged builds.

2. Window close can race async save and lose recent edits (`src/renderer.ts`)
   - The renderer `beforeunload` handler triggers an async save but does not block teardown while the IPC save completes.
   - If the user closes/quits before autosave fires, the renderer may be destroyed before the final save finishes, causing data loss risk.
   - Deferred for now; needs explicit close/quit interception and flush coordination.
