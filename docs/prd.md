# Product Requirements Document: Local Agentic Writing Editor

## Vision

A lightweight desktop application (Electron) that provides a beautiful, prose-first editing experience on top of plain Markdown files, using locally-installed coding agents (Claude Code, Codex, etc.) as the AI backend. The filesystem is the database. Git is the version control. The agent is whatever the user already has.

**Core insight:** Coding agents like Claude Code and Codex are already installed on millions of developer machines and already know how to read, edit, and manage text files. A writing-focused editor doesn't need to re-implement any of that — it just needs to present the results beautifully and provide a workflow designed for prose instead of code.

**Philosophy:** This is an OpenClaw-style bet — the product is a thin, opinionated UI layer on top of an infinitely capable agent. Features aren't things we build; they're things the agent can already do. Our job is to make the most common writing workflows fast and pleasant, and get out of the way for everything else.

---

## Target User

Technical writers, developer-bloggers, and power users who already have a coding agent installed and are comfortable with a local-first, files-on-disk workflow. They likely already use Obsidian, a static site generator, or a git-based publishing setup. They want an editor that's prettier than VS Code for prose but doesn't sacrifice the power of their existing tools.

---

## Project Structure on Disk

A project is just a folder. No proprietary format, no database, no lock-in.

```
my-writing-project/
├── .editor/                    # Editor metadata (gitignored or committed, user's choice)
│   ├── config.yaml             # Project settings, agent preferences
│   └── skills/                 # Custom skill definitions
│       ├── de-slop.md
│       ├── tighten.md
│       └── my-newsletter-voice.md
├── posts/
│   ├── why-monoliths-win.md
│   ├── why-monoliths-win.comments.md   # Sidecar comment file
│   ├── ai-editor-manifesto.md
│   └── ai-editor-manifesto.comments.md
└── drafts/
    └── half-baked-idea.md
```

**Key properties:**
- Every document is a standard Markdown file. Open it in any editor, it works.
- Comments live in a sidecar `.comments.md` (or `.comments.json`) file with a structured format linking annotations to text anchors.
- Skills are Markdown files containing prompt templates. The agent can read them, the user can edit them, and — crucially — the user can ask the agent to write new skills.
- Git handles versioning. The editor can trigger commits at key moments (before/after agent passes) but doesn't invent its own version control.
- The `.editor/` directory is the only thing that's specific to this tool. Everything else is portable.

---

## Core Requirements

### 1. WYSIWYG Rendering of Markdown

- Renders Markdown files as beautifully formatted prose in a TipTap/ProseMirror-based editor panel
- Bidirectional sync: edits in the WYSIWYG view write back to the Markdown file; external changes to the Markdown file (from the agent or any other tool) update the rendered view
- The writer never has to look at raw Markdown unless they want to (optional toggle to a raw/split view)
- Handles standard Markdown features: headings, bold/italic, links, images, blockquotes, code blocks, lists

### 2. Agent Integration via Local Coding Tools

- **Auto-detection:** On startup, the editor scans for locally-installed agents (Claude Code, Codex, etc.) and presents what's available. The user picks a default or can switch per-operation.
- **Invocation model:** When the user triggers an agent action, the editor:
  1. Saves the current file state
  2. Creates a git commit as a snapshot (automatic, with a descriptive message like "Pre-agent: tighten paragraph 3")
  3. Constructs a prompt from the user's instruction + relevant context (the file, the selection, the skill template, the comments file)
  4. Invokes the agent (via CLI subprocess or SDK, depending on the tool)
  5. Waits for the agent to finish modifying the file(s) on disk
  6. Diffs the file before/after to determine what changed
  7. Presents the changes in the UI for review
- **The agent operates on the raw Markdown file.** It has full read/write access to the project directory. This means it can also read other files in the project (for cross-referencing), access the comments file, and even modify the skills files if asked.
- **Unbounded capability:** Because the agent is a full coding agent, it can do anything the user asks — web search, file creation, running scripts, reading external data sources. We don't limit this. The editor is a workflow layer, not a sandbox.

### 3. Comments & Annotations

- Margin comments displayed alongside the rendered text, attached to specific text ranges
- Comments stored in a sidecar file (e.g., `my-post.comments.md`) with a structured format:
  - Text anchor (enough quoted text to uniquely identify the location, similar to the `str_replace` pattern)
  - Author (user, collaborator name, or "agent")
  - Timestamp
  - Comment body
  - Status (open, resolved)
- The agent can read and write to this file, which means:
  - Skills can leave comments instead of (or in addition to) making edits
  - The user can @-tag the agent in a comment, and later ask the agent to "process all comments tagged for you"
  - The agent can be instructed to "review this document and leave comments on weak sections" without editing anything
- Comments are excluded from any Markdown export — the sidecar file stays behind

### 4. Snapshot History via Git

- **Automatic commits:** Before and after every agent operation, the editor creates a git commit. These are lightweight and automatic — the user doesn't interact with git directly unless they want to.
- **Snapshot browser:** A UI panel that shows the commit history as a timeline of snapshots, with descriptive labels ("Pre-agent: grammar check", "Post-agent: grammar check — 7 edits applied")
- **Visual diff between snapshots:** Select any two snapshots and see a word-level prose diff — insertions highlighted, deletions struck through — rendered in the WYSIWYG style, not as a raw git diff
- **One-click rollback:** Revert to any snapshot instantly (git reset/checkout under the hood)
- **Comment state is versioned too:** Because comments live in a sidecar file that's also in the git repo, rolling back restores the comments as they were at that point
- Standard undo/redo (Ctrl+Z) still works for the user's own keystrokes between snapshots

### 5. Skills System

- Skills are Markdown files in `.editor/skills/` containing:
  - A description of what the skill does
  - A prompt template (with placeholders for the document content, selection, etc.)
  - Optional parameters (e.g., "target reading level: 8th grade")
- **Built-in skills** (shipped with the editor, can be customized):
  - Consistency check
  - De-slop (remove LLM artifacts)
  - Flow check
  - Readability check
  - Grammar & mechanics
  - Tighten
- **Custom skills:** The user creates new `.md` files in the skills directory. Or, more powerfully, asks the agent: "Create a skill that checks whether I'm using passive voice too much" — and the agent writes the skill file.
- **Skill invocation:** Select text (or the whole document) → pick a skill from a palette → the editor constructs the prompt, invokes the agent, and presents the results
- **Skill output modes:**
  - **Edit mode:** The skill produces file modifications (shown as diffs for review)
  - **Comment mode:** The skill produces annotations (written to the comments file, displayed in the margin)
  - **Chat mode:** The skill produces a conversational response (shown in the chat panel)
- **Batch pipeline:** Chain skills in sequence (e.g., grammar → de-slop → tighten). Each step commits a snapshot before running.

### 6. Document Chat

- A chat panel where the writer can converse with the agent about the document
- The agent always has the current document as context
- Chat can be purely conversational ("Is my argument coherent?") or can result in edits ("Fix the grammar in the third paragraph")
- When chat results in edits, the same snapshot → agent → diff → review flow applies
- Chat history is stored locally (in `.editor/` or in the sidecar) and persists across sessions

### 7. Multi-Document Workspace

- Sidebar showing all Markdown files in the project directory (and subdirectories)
- Click to switch between documents
- One document active at a time
- Basic organization via the filesystem (folders = categories)
- The agent can be asked to work across documents ("Find any contradictions between these two posts") since it has access to the full project directory

### 8. Selection-Based Agent Interaction

- Highlight any text range in the WYSIWYG view
- A floating toolbar or keyboard shortcut opens a command input
- Type a natural language instruction ("Make this punchier", "Expand on this idea", "Rewrite for a technical audience")
- The editor constructs the prompt with the selection context and invokes the agent
- Results appear as a proposed diff scoped to the selected region

---

## Non-Requirements for v1

- **Real-time collaboration.** This is a single-user, local-first tool. Collaboration happens via git (share the repo) or by exporting and sharing files. No concurrent multi-user editing.
- **Cloud sync.** Files live on the user's machine. If they want sync, they use Dropbox, iCloud, or git.
- **Account system / auth.** No login, no accounts. The editor is a local app.
- **Mobile.** Desktop only.
- **Custom themes / rich formatting beyond Markdown.** We render standard Markdown beautifully. We don't add proprietary formatting features that wouldn't survive export.

---

## Architecture

### Desktop Shell

- **Electron app** wrapping a web-based frontend
- The Electron main process handles: filesystem access, git operations, agent subprocess management, file watching
- The renderer process is a standard web app: TipTap/ProseMirror editor, React UI, chat panel, diff viewer

### Agent Abstraction Layer

The editor doesn't care which agent it's talking to. An adapter interface normalizes the invocation:

```
interface AgentAdapter {
  detect(): boolean            // Is this agent installed?
  invoke(prompt: string, workingDir: string): Promise<AgentResult>
  stream?(prompt: string, workingDir: string): AsyncIterable<AgentEvent>  // Optional streaming
}
```

**Adapters to build:**
- **Claude Code:** Invoke via `claude -p "prompt" --directory /path/to/project` or via the SDK
- **Codex:** Invoke via `codex "prompt"` or equivalent CLI
- **Fallback / direct API:** If no local agent is installed, fall back to a direct API call with a simple `str_replace` tool (as described in the SaaS PRD). This ensures the editor works even without a full coding agent, just with an API key.

### File Watching

- The Electron main process watches the project directory for changes (via `chokidar` or Node's `fs.watch`)
- When the agent modifies a file, the watcher detects it and signals the renderer to reload
- Challenge: distinguishing between "the user saved from our editor" and "the agent modified the file externally." Approach: the editor sets a flag when it writes, and ignores the resulting filesystem event. Any unexpected file change triggers a reload + diff.

### Diff Computation

- Since the agent modifies files directly (unlike the SaaS version where we get structured tool calls), we need to compute diffs ourselves
- Use `diff-match-patch` or a similar library for word-level diffing of prose
- The pre-agent git snapshot serves as the "before" state; the current file is the "after"
- Render diffs in the WYSIWYG view: insertions highlighted in green, deletions in red with strikethrough

### Comment Anchor Resolution

- Comments reference text by quoting a unique substring (the anchor)
- When the file changes (user edit or agent edit), anchors may need re-resolution
- Strategy: on each file change, attempt to re-match each comment's anchor text. If the anchor text has been modified or deleted, mark the comment as "orphaned" and surface it to the user for resolution
- This is the same fuzzy-matching problem that `str_replace` faces, and the same solution works: require enough context for uniqueness

---

## What Makes This Different from Just Using Cursor

| Capability | Cursor | This Editor |
|---|---|---|
| WYSIWYG prose rendering | ❌ Raw text / Markdown preview | ✅ Full WYSIWYG |
| Margin comments / annotations | ❌ | ✅ With sidecar storage |
| Writing-specific skills (de-slop, flow, etc.) | ❌ (could use .cursor/rules) | ✅ Purpose-built |
| Prose-optimized diff view | ❌ Line-based code diffs | ✅ Word-level prose diffs |
| Agent integration | ✅ Built-in | ✅ Wraps the same agents |
| Non-technical user accessible | ❌ It's a code editor | ⚠️ Better, but still requires local agent setup |
| Git-based versioning | ✅ | ✅ |
| Extension ecosystem | ✅ VS Code extensions | ❌ |

---

## Risks & Open Questions

- **WYSIWYG ↔ Markdown sync fidelity:** Bidirectional sync between a rich text editor and a Markdown file is a known hard problem. Roundtrip fidelity (edit in WYSIWYG → save as Markdown → re-open → looks identical) needs to be bulletproof. Libraries like Milkdown and TipTap's Markdown extension help, but edge cases will exist.
- **Agent output unpredictability:** A full coding agent can do anything — including things you didn't want. It could reformat the entire file, add metadata, or break the Markdown structure. Mitigation: the automatic pre-agent snapshot means you can always roll back. The diff review step catches unexpected changes.
- **Comment anchor stability:** As the document evolves, text anchors for comments may break. How aggressively do we try fuzzy matching? When do we give up and mark a comment as orphaned?
- **Agent invocation latency:** Shelling out to Claude Code or Codex has overhead — process startup, authentication, model loading. A "tighten this paragraph" operation might take 10-20 seconds. Is that acceptable? Would a direct API fallback for quick operations improve the feel?
- **Detecting installed agents:** What's the most reliable way to detect that Claude Code, Codex, etc. are installed and configured? Check `$PATH`? Try running them with a no-op? What's the UX when nothing is found — do we guide the user through installation?
- **Electron bundle size and performance:** Electron apps are notoriously heavy. Is Tauri (Rust-based, smaller footprint) a better choice? TipTap/ProseMirror run fine in both.
- **The "why not just use Cursor" question:** The primary differentiators are WYSIWYG rendering, margin comments, and prose-specific skills/diffs. If those don't feel meaningfully better than Cursor + a Markdown preview extension, the product doesn't have a reason to exist. The prototype needs to validate this.