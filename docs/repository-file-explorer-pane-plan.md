# Repository File Explorer Pane Plan

## Goal

Add a collapsible file explorer pane on the left side of the workspace that behaves like the existing right-side terminal pane:

- lives under the main workspace layout as a peer pane
- can be collapsed and expanded
- has a draggable divider
- opens files immediately when clicked
- stays rooted at the current file's git repository root

If the active file is not inside a git repository, the explorer should show nothing.

## Product Rules

- The explorer root is the git repository root for the active file.
- Tracked vs untracked does not matter. If the active file is inside a git repo, show markdown files from the repo filesystem.
- Only markdown files should appear.
- Folders should be collapsible and expandable.
- The active file should be highlighted and its ancestor folders should auto-expand.
- Clicking a file should open it through the same application path used by the rest of the app.

## Architectural Direction

The best fit is to keep layout and explorer logic separate:

- `App` owns workspace layout, pane ordering, divider drag, collapse state, and native window resizing.
- `RepositoryFileExplorerPane` owns repo-tree loading, expanded folder state, active-file reveal, and tree interactions.
- Main process owns filesystem and git queries.
- Preload exposes a narrow explorer API to the renderer.

This keeps the explorer sibling-agnostic. It should not know whether the editor or terminal exists.

## Why This Fits The Existing Code

The current app already has the right primitives:

- The renderer already owns pane layout and right-pane collapse behavior in `src/renderer/App.tsx`.
- The workspace already has a divider and collapse model in `src/index.css`.
- Main already knows how to resolve the current file's git repo root in `src/main/markdown-file-service.ts`.
- Main already has a helper that activates a file at an explicit path in `src/main/markdown-file-service.ts`.
- Preload already exposes narrow typed file APIs in `src/preload.ts`.

So this is not a new architecture. It is a generalization of the one already in place.

## Recommended Implementation

### 1. Generalize the workspace shell

Refactor the current `main` workspace into three peer panes:

- left explorer pane
- center document pane
- right terminal pane

Each sidebar gets:

- its own collapsed state
- its own remembered expanded width
- its own divider
- its own topbar toggle button

The workspace shell should know only:

- pane order
- pane widths
- which panes are collapsed
- how to resize the native window when a sidebar collapses or expands

The workspace shell should not know how the explorer builds its tree.

### 2. Add explorer IPC in main/preload

Add new main-process operations for the active file context:

- `editor:get-current-file-repository-markdown-tree`
- `editor:open-markdown-file-at-path`
- `editor:on-current-markdown-file-path-changed` event

Suggested response shape:

```ts
type RepositoryMarkdownTreeResponse =
  | { ok: true; repositoryRoot: string; activeFilePath: string; tree: ExplorerNode[] }
  | { ok: false; reason: 'not-in-git-repo' | 'load-failed'; errorMessage?: string };

type ExplorerNode =
  | {
      type: 'directory';
      name: string;
      path: string;
      children: ExplorerNode[];
    }
  | {
      type: 'file';
      name: string;
      path: string;
    };
```

`open-markdown-file-at-path` should reuse the existing `activateMarkdownFileAtPath(...)` helper so explorer clicks follow the same active-document path as the rest of the app.

### 3. Build the tree from the filesystem, not git index state

The explorer should use `git rev-parse --show-toplevel` only to find the root.

After that, walk the filesystem and:

- skip `.git`
- include only markdown files
- include directories only if they contain markdown descendants
- sort directories before files
- sort names case-insensitively
- avoid following symlinked directories

This matches the requirement that untracked markdown files still show up.

### 4. Build the explorer as an isolated pane component

`RepositoryFileExplorerPane` should receive only app-level inputs like:

- `isCollapsed`
- `activeFilePath`
- `onRequestOpenFile(filePath)`

Or, if preferred, it can be even more isolated and call the preload explorer API directly for:

- loading the current tree
- listening for active-file changes
- opening a file

That second option gives stronger isolation because it removes sibling coordination entirely.

### 5. Match VS Code-style interaction patterns

The UI should follow common explorer expectations:

- single click opens file immediately
- chevron toggles folder open/closed
- clicking a folder row can also toggle it
- active file gets a distinct highlight
- active file's parent chain auto-expands
- keyboard tree behavior follows ARIA treeview expectations

Good defaults:

- explorer visible by default only when the active file is inside a git repo
- collapse the pane entirely when the active file is outside git
- preserve manual folder expansion state while staying in the same repo
- reset expansion state when switching to a different repo, except for auto-expanding the active file path

## Proposals

### Proposal 1: Minimal retrofit

Extend the existing grid directly to:

- explorer
- divider
- editor
- divider
- terminal

Pros:

- least file movement
- fastest path to a working result

Cons:

- `App.tsx` becomes more layout-specific
- current single-divider assumptions become harder to maintain
- responsive behavior gets more fragile

### Proposal 2: Nested workbench shell

Create a reusable workspace shell that renders:

- left sidebar
- center content
- right sidebar

Then plug in:

- `RepositoryFileExplorerPane`
- `DocumentCommentsPane`
- `TerminalPane`

Pros:

- best component boundaries
- easiest place to add a second divider cleanly
- preserves explorer independence

Cons:

- slightly more refactor up front than proposal 1

### Proposal 3: Dedicated repository explorer service

Add a main-process service responsible for:

- repo root resolution
- repo tree caching
- filesystem watching under the repo root
- pushing tree updates when markdown files appear, disappear, or move

Pros:

- strongest long-term architecture
- best for large repos and future explorer actions

Cons:

- more code now
- likely unnecessary for the first version

### Proposal 4: Third-party tree or split-pane library

Use a library for either:

- tree rendering
- split-pane layout
- or both

Pros:

- less custom accessibility work
- potentially faster to polish keyboard interactions

Cons:

- adds dependency weight
- can fight the existing bespoke layout and visual language
- likely overkill for this app's current surface area

## Recommendation

Use proposal 2 now.

That means:

- keep the explorer pane as a first-class sibling under the workspace
- keep all explorer behavior inside `RepositoryFileExplorerPane`
- keep layout math in a generalized workspace shell
- keep file-opening and repo-tree logic behind main/preload APIs

This gives the desired isolation without overbuilding the first version.

## State Ownership

### Workspace shell state

- left pane collapsed/expanded
- left pane width
- right pane collapsed/expanded
- right pane width
- drag interactions
- native window width adjustments

### Explorer pane state

- current repo tree
- expanded directory paths
- loading/error state
- active file path
- derived auto-expanded ancestor chain

### Main-process state

- active markdown file path
- git repo root lookup
- filesystem tree building
- file activation by path

## Event Flow

### User clicks a file in the explorer

1. Explorer requests `openMarkdownFileAtPath(filePath)`.
2. Main activates the file through the existing active-document path.
3. App reloads the new active document.
4. Main emits active-file-changed.
5. Explorer receives the new active file path and updates highlight and folder expansion.

### Some other UI path opens a file

1. Another app action activates a new file.
2. Main emits active-file-changed.
3. Explorer reloads or reconciles repo context.
4. Explorer updates highlight and expanded ancestors.

This keeps the explorer decoupled from sibling components.

## Testing Plan

### Unit tests

- repo-root resolution for active file
- filesystem tree builder includes untracked markdown files
- non-markdown files are excluded
- empty folders are pruned
- directories sort before files
- active file ancestor auto-expansion

### E2E tests

- explorer collapse/expand resizes the native window like the terminal pane
- clicking a file in the explorer opens it immediately
- switching files outside the explorer updates active highlight
- non-git active file hides or disables the explorer
- folder collapse and expand behavior persists while staying in the same repo

## Risks

- The current responsive mobile layout collapses the workspace into a vertical stack. A two-sidebar layout will need explicit responsive rules instead of relying on the current one-size-fits-all behavior.
- Large repos could make a full synchronous tree walk feel heavy if not cached.
- The current `App.tsx` layout code assumes one sidebar. That code should be generalized instead of duplicated.

## Implementation Checklist

- Add shared explorer types in `src/shared-types.ts`
- Add main-process repo-tree and open-by-path IPC handlers
- Add preload bridge methods for explorer operations
- Add renderer-side explorer API wrapper
- Add `RepositoryFileExplorerPane.tsx`
- Refactor workspace layout to support left and right sidebars
- Add topbar explorer toggle
- Add divider drag logic for left and right panes
- Add CSS for explorer rows, nesting, active state, and collapse behavior
- Add unit tests for tree building
- Add E2E tests for explorer interaction and collapse/expand
