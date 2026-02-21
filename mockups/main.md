<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prosa — Local Agentic Writing Editor</title>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,300;1,6..72,400;1,6..72,500&family=JetBrains+Mono:wght@300;400;500&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    /* Writing surface — warm, papery */
    --paper: #FAF8F5;
    --paper-edge: #F0EDE8;
    --ink: #2C2A26;
    --ink-light: #6B6860;
    --ink-faint: #A8A49C;
    --ink-ghost: #D4D0C8;

    /* Agent pane — cool, precise */
    --terminal-bg: #1C1E24;
    --terminal-surface: #252830;
    --terminal-border: #33363F;
    --terminal-text: #C8CCD4;
    --terminal-dim: #6B7080;
    --terminal-accent: #7EB8E0;
    --terminal-green: #8BBF72;
    --terminal-amber: #D4A54A;
    --terminal-red: #CF6B6B;

    /* Sidebar */
    --sidebar-bg: #2A2D35;
    --sidebar-text: #9BA0AD;
    --sidebar-active: #E8E6E1;
    --sidebar-hover: #33363F;

    /* Accents */
    --accent: #C85D3A;
    --accent-soft: rgba(200, 93, 58, 0.12);
    --accent-blue: #5B8DB5;
    --accent-blue-soft: rgba(91, 141, 181, 0.1);

    /* Comments */
    --comment-bg: #FFF9F0;
    --comment-border: #E8D9C4;
    --comment-agent-bg: #F0F5FA;
    --comment-agent-border: #C4D6E8;

    /* Diff */
    --diff-add-bg: rgba(139, 191, 114, 0.15);
    --diff-add-text: #5A8A3C;
    --diff-del-bg: rgba(207, 107, 107, 0.12);
    --diff-del-text: #B05555;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--terminal-bg);
    color: var(--ink);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ========== TITLE BAR ========== */
  .titlebar {
    height: 40px;
    background: var(--sidebar-bg);
    border-bottom: 1px solid var(--terminal-border);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }

  .titlebar-dots {
    display: flex;
    gap: 7px;
    -webkit-app-region: no-drag;
  }

  .titlebar-dot {
    width: 11px; height: 11px;
    border-radius: 50%;
  }
  .titlebar-dot.red { background: #EC6A5E; }
  .titlebar-dot.yellow { background: #F4BF4F; }
  .titlebar-dot.green { background: #61C554; }

  .titlebar-title {
    font-size: 12px;
    color: var(--sidebar-text);
    font-weight: 400;
    letter-spacing: 0.3px;
    margin-left: 12px;
  }

  .titlebar-project {
    color: var(--sidebar-active);
    font-weight: 500;
  }

  .titlebar-agent-status {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--terminal-green);
    -webkit-app-region: no-drag;
  }

  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--terminal-green);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ========== MAIN LAYOUT ========== */
  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ========== FILE EXPLORER ========== */
  .sidebar {
    width: 190px;
    min-width: 140px;
    flex: none;
    background: var(--sidebar-bg);
    border-right: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 14px 14px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--terminal-dim);
    font-weight: 500;
    border-bottom: 1px solid var(--terminal-border);
  }

  .file-tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .file-tree::-webkit-scrollbar { width: 4px; }
  .file-tree::-webkit-scrollbar-thumb { background: var(--terminal-border); border-radius: 2px; }

  .tree-folder {
    padding: 5px 14px;
    font-size: 12px;
    color: var(--terminal-dim);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .tree-folder .caret {
    font-size: 8px;
    transition: transform 0.15s;
  }

  .tree-file {
    padding: 4px 14px 4px 30px;
    font-size: 12px;
    color: var(--sidebar-text);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 7px;
    transition: background 0.1s, color 0.1s;
    border-left: 2px solid transparent;
  }

  .tree-file:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-active);
  }

  .tree-file.active {
    background: rgba(200, 93, 58, 0.08);
    color: var(--sidebar-active);
    border-left-color: var(--accent);
  }

  .tree-file .file-icon {
    font-size: 10px;
    opacity: 0.5;
  }

  .tree-file .comment-badge {
    margin-left: auto;
    font-size: 9px;
    background: var(--accent);
    color: white;
    border-radius: 8px;
    padding: 1px 5px;
    font-weight: 500;
  }

  .sidebar-footer {
    padding: 10px 14px;
    border-top: 1px solid var(--terminal-border);
    font-size: 10px;
    color: var(--terminal-dim);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sidebar-footer .snapshot-icon {
    color: var(--terminal-green);
  }

  /* ========== EDITOR PANE ========== */
  .editor-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    position: relative;
  }

  .editor-toolbar {
    height: 42px;
    background: var(--paper);
    border-bottom: 1px solid var(--paper-edge);
    display: flex;
    align-items: center;
    padding: 0 24px;
    gap: 4px;
    flex-shrink: 0;
  }

  .toolbar-btn {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--ink-light);
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.12s;
    font-family: 'DM Sans', sans-serif;
  }

  .toolbar-btn:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .toolbar-divider {
    width: 1px;
    height: 18px;
    background: var(--ink-ghost);
    margin: 0 6px;
  }

  .toolbar-skill-btn {
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid var(--ink-ghost);
    background: transparent;
    color: var(--ink-light);
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    font-family: 'DM Sans', sans-serif;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.12s;
  }

  .toolbar-skill-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .toolbar-snapshot-btn {
    padding: 4px 10px;
    border: 1px solid var(--ink-ghost);
    background: transparent;
    color: var(--ink-light);
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    font-family: 'DM Sans', sans-serif;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.12s;
  }

  .toolbar-snapshot-btn:hover {
    border-color: var(--accent-blue);
    color: var(--accent-blue);
    background: var(--accent-blue-soft);
  }

  .editor-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
  }

  .editor-scroll::-webkit-scrollbar { width: 6px; }
  .editor-scroll::-webkit-scrollbar-thumb { background: var(--ink-ghost); border-radius: 3px; }
  .editor-scroll::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); }

  .editor-content {
    flex: 1;
    max-width: 680px;
    margin: 0 auto;
    padding: 48px 40px 120px;
    position: relative;
  }

  .comment-gutter {
    width: 260px;
    flex-shrink: 0;
    position: relative;
    padding-top: 48px;
  }

  /* Typography — the writing surface */
  .editor-content h1 {
    font-family: 'Newsreader', serif;
    font-size: 38px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.2;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }

  .editor-content .subtitle {
    font-family: 'Newsreader', serif;
    font-size: 18px;
    font-weight: 300;
    font-style: italic;
    color: var(--ink-light);
    margin-bottom: 36px;
    line-height: 1.5;
  }

  .editor-content .meta {
    font-size: 12px;
    color: var(--ink-faint);
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--paper-edge);
    display: flex;
    gap: 16px;
  }

  .editor-content h2 {
    font-family: 'Newsreader', serif;
    font-size: 24px;
    font-weight: 500;
    color: var(--ink);
    margin-top: 40px;
    margin-bottom: 16px;
    line-height: 1.3;
  }

  .editor-content p {
    font-family: 'Newsreader', serif;
    font-size: 17px;
    line-height: 1.75;
    color: var(--ink);
    margin-bottom: 18px;
  }

  .editor-content blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 20px;
    margin: 24px 0;
    font-style: italic;
    color: var(--ink-light);
  }

  .editor-content blockquote p {
    font-size: 16px;
    color: var(--ink-light);
  }

  /* Highlighted text (selected for agent) */
  .highlight-selection {
    background: var(--accent-soft);
    border-bottom: 2px solid var(--accent);
    padding: 1px 0;
    cursor: pointer;
    position: relative;
  }

  /* Agent diff markers */
  .diff-added {
    background: var(--diff-add-bg);
    color: var(--diff-add-text);
    padding: 1px 2px;
    border-radius: 2px;
    text-decoration: none;
  }

  .diff-removed {
    background: var(--diff-del-bg);
    color: var(--diff-del-text);
    padding: 1px 2px;
    border-radius: 2px;
    text-decoration: line-through;
  }

  /* Comment anchors in text */
  .comment-anchor {
    background: rgba(232, 217, 196, 0.35);
    border-bottom: 2px dotted var(--comment-border);
    cursor: pointer;
    position: relative;
  }

  .comment-anchor-agent {
    background: rgba(196, 214, 232, 0.3);
    border-bottom: 2px dotted var(--comment-agent-border);
  }

  /* ========== FLOATING COMMENTS ========== */
  .comment-bubble {
    position: absolute;
    width: 230px;
    left: 14px;
    background: var(--comment-bg);
    border: 1px solid var(--comment-border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12.5px;
    color: var(--ink-light);
    line-height: 1.55;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    transition: box-shadow 0.15s;
    cursor: pointer;
  }

  .comment-bubble:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  }

  .comment-bubble.agent {
    background: var(--comment-agent-bg);
    border-color: var(--comment-agent-border);
  }

  .comment-author {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .comment-author .author-you { color: var(--accent); }
  .comment-author .author-agent { color: var(--accent-blue); }

  .comment-tag {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .tag-todo {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .tag-agent {
    background: var(--accent-blue-soft);
    color: var(--accent-blue);
  }

  .comment-text {
    font-family: 'DM Sans', sans-serif;
  }

  .comment-time {
    font-size: 10px;
    color: var(--ink-faint);
    margin-top: 6px;
  }

  .comment-resolve {
    font-size: 10px;
    color: var(--accent-blue);
    margin-top: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .comment-resolve:hover { text-decoration: underline; }

  /* ========== CHAT PANE ========== */
  .chat-pane {
    width: 30%;
    min-width: 280px;
    flex: none;
    background: var(--terminal-bg);
    border-left: none;
    display: flex;
    flex-direction: column;
  }

  .chat-header {
    height: 42px;
    border-bottom: 1px solid var(--terminal-border);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 10px;
    flex-shrink: 0;
  }

  .chat-tab {
    font-size: 12px;
    color: var(--terminal-dim);
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.12s;
  }

  .chat-tab.active {
    color: var(--terminal-text);
    background: var(--terminal-surface);
  }

  .chat-tab:hover:not(.active) {
    color: var(--terminal-text);
  }

  .chat-header .model-indicator {
    margin-left: auto;
    font-size: 10px;
    color: var(--terminal-dim);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .model-indicator .model-name {
    color: var(--terminal-accent);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .chat-messages::-webkit-scrollbar { width: 4px; }
  .chat-messages::-webkit-scrollbar-thumb { background: var(--terminal-border); border-radius: 2px; }

  .chat-msg {
    max-width: 100%;
    animation: msgIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes msgIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .chat-msg.user .msg-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--terminal-amber);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .chat-msg.agent .msg-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--terminal-accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .msg-content {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--terminal-text);
  }

  .msg-content p {
    margin-bottom: 8px;
  }

  .msg-content p:last-child { margin-bottom: 0; }

  /* Diff block in chat */
  .chat-diff {
    background: var(--terminal-surface);
    border: 1px solid var(--terminal-border);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.7;
  }

  .chat-diff .diff-header {
    font-size: 10px;
    color: var(--terminal-dim);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--terminal-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .chat-diff .diff-location {
    font-style: italic;
    color: var(--terminal-dim);
    font-size: 10.5px;
  }

  .chat-diff .diff-line-del {
    color: var(--terminal-red);
    opacity: 0.8;
  }

  .chat-diff .diff-line-add {
    color: var(--terminal-green);
  }

  .chat-diff-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }

  .diff-action-btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--terminal-border);
    cursor: pointer;
    transition: all 0.12s;
    background: transparent;
  }

  .diff-action-btn.accept {
    color: var(--terminal-green);
    border-color: rgba(139, 191, 114, 0.3);
  }

  .diff-action-btn.accept:hover {
    background: rgba(139, 191, 114, 0.12);
    border-color: var(--terminal-green);
  }

  .diff-action-btn.reject {
    color: var(--terminal-red);
    border-color: rgba(207, 107, 107, 0.3);
  }

  .diff-action-btn.reject:hover {
    background: rgba(207, 107, 107, 0.1);
    border-color: var(--terminal-red);
  }

  .diff-action-btn.accept-all {
    color: var(--terminal-green);
    border-color: rgba(139, 191, 114, 0.3);
    margin-left: auto;
  }

  .diff-action-btn.accept-all:hover {
    background: rgba(139, 191, 114, 0.12);
    border-color: var(--terminal-green);
  }

  /* Agent thinking indicator */
  .agent-thinking {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--terminal-dim);
    font-family: 'JetBrains Mono', monospace;
    padding: 6px 0;
  }

  .thinking-dots {
    display: flex;
    gap: 3px;
  }

  .thinking-dots span {
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--terminal-accent);
    animation: dotPulse 1.2s infinite;
  }

  .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dotPulse {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 1; }
  }

  /* Summary bar for batch changes */
  .changes-summary {
    background: var(--terminal-surface);
    border: 1px solid var(--terminal-border);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 6px 0;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
  }

  .changes-summary .stat {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .changes-summary .stat.adds { color: var(--terminal-green); }
  .changes-summary .stat.dels { color: var(--terminal-red); }
  .changes-summary .stat.files { color: var(--terminal-amber); }

  /* Chat input */
  .chat-input-area {
    padding: 12px 16px;
    border-top: 1px solid var(--terminal-border);
    flex-shrink: 0;
  }

  .chat-input-wrap {
    background: var(--terminal-surface);
    border: 1px solid var(--terminal-border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    transition: border-color 0.15s;
  }

  .chat-input-wrap:focus-within {
    border-color: var(--terminal-accent);
  }

  .chat-input-wrap textarea {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    color: var(--terminal-text);
    resize: none;
    line-height: 1.5;
    max-height: 120px;
  }

  .chat-input-wrap textarea::placeholder {
    color: var(--terminal-dim);
  }

  .chat-send-btn {
    width: 28px; height: 28px;
    border-radius: 6px;
    border: none;
    background: var(--terminal-accent);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: background 0.12s;
    flex-shrink: 0;
  }

  .chat-send-btn:hover { background: #6AA8D0; }

  .chat-input-hints {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    padding: 0 2px;
  }

  .chat-input-hints span {
    font-size: 10px;
    color: var(--terminal-dim);
    font-family: 'JetBrains Mono', monospace;
  }

  .chat-input-hints kbd {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    padding: 1px 4px;
    background: var(--terminal-border);
    border-radius: 2px;
    color: var(--terminal-text);
  }

  /* ========== RESIZE HANDLES ========== */
  .resize-handle {
    width: 5px;
    cursor: col-resize;
    background: var(--terminal-border);
    flex-shrink: 0;
    position: relative;
    z-index: 20;
    transition: background 0.15s;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0; bottom: 0;
    left: -3px; right: -3px;
  }

  .resize-handle:hover,
  .resize-handle.active {
    background: var(--terminal-accent);
  }

  .resize-handle.sidebar-handle {
    background: var(--terminal-border);
  }

  .resize-handle.chat-handle {
    background: var(--terminal-border);
  }

  body.resizing {
    cursor: col-resize;
    user-select: none;
  }

  body.resizing * {
    pointer-events: none;
  }

  body.resizing .resize-handle {
    pointer-events: auto;
  }

  /* ========== EDITOR STATUS BAR ========== */
  .statusbar {
    height: 26px;
    background: var(--sidebar-bg);
    border-top: 1px solid var(--terminal-border);
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 10.5px;
    color: var(--terminal-dim);
    font-family: 'JetBrains Mono', monospace;
    gap: 16px;
    flex-shrink: 0;
  }

  .statusbar .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .statusbar .git-branch {
    color: var(--terminal-accent);
  }

  .statusbar .word-count { color: var(--terminal-dim); }

  .statusbar .snapshot-status {
    margin-left: auto;
    color: var(--terminal-green);
    display: flex;
    align-items: center;
    gap: 4px;
  }
</style>
</head>
<body>

<!-- Title Bar -->
<div class="titlebar">
  <div class="titlebar-dots">
    <div class="titlebar-dot red"></div>
    <div class="titlebar-dot yellow"></div>
    <div class="titlebar-dot green"></div>
  </div>
  <span class="titlebar-title">Prosa — <span class="titlebar-project">my-writing-project</span></span>
  <div class="titlebar-agent-status">
    <div class="status-dot"></div>
    Claude Code connected
  </div>
</div>

<!-- Main Layout -->
<div class="main">

  <!-- Editor Pane -->
  <div class="editor-pane" id="editorPane">
    <div class="editor-toolbar">
      <button class="toolbar-btn"><b>B</b></button>
      <button class="toolbar-btn"><i>I</i></button>
      <button class="toolbar-btn" style="text-decoration: underline;">U</button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn">H1</button>
      <button class="toolbar-btn">H2</button>
      <button class="toolbar-btn">H3</button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn">❝</button>
      <button class="toolbar-btn">—</button>
      <button class="toolbar-btn">🔗</button>
      <button class="toolbar-snapshot-btn">⟲ Snapshots</button>
      <button class="toolbar-skill-btn">⚡ Skills</button>
    </div>

    <div class="editor-scroll">
      <div class="editor-content">
        <h1>Why Monoliths Win at the Early Stage</h1>

        <p>There's a recurring pattern I've seen across a decade of building startups: a small team, fresh off a seed round, spends its first two months arguing about microservices. They draw elaborate architecture diagrams. They debate message queues. They provision Kubernetes clusters for an application that has forty-three users and a burn rate that would make their investors weep.</p>

        <p><span class="comment-anchor">I've done this myself. At my first startup, we split a Django app into six services before we had six customers.</span> The reasoning felt sound at the time — we were "building for scale." In reality, we were building for a future that might never arrive, and paying for that premature complexity with the only currency a startup can't afford to waste: engineering time.</p>

        <h2>The Coordination Tax</h2>

        <p>The fundamental problem with distributed systems at the early stage isn't technical — it's <em>organizational</em>. Every service boundary is a communication boundary. Every API contract is a negotiation. Every deployment becomes a choreographed dance where <span class="diff-removed">six</span><span class="diff-added">multiple</span> things have to go right instead of one.</p>

        <p>With fifteen engineers, you don't have the luxury of dedicated platform teams. <span class="comment-anchor-agent">The person debugging the message queue on Tuesday is the same person building the checkout flow on Wednesday.</span> Context-switching between "distributed systems engineer" and "product engineer" is a tax that compounds silently until one day you realize your team is moving at half the speed of a competitor who just has a Rails monolith and a Postgres database.</p>

        <blockquote>
          <p>The best architecture is the one that lets your team ship features to real users as fast as possible. At fifteen people, that's almost always a monolith.</p>
        </blockquote>

        <h2>When to Actually Split</h2>

        <p>None of this means microservices are wrong. They're a tool, and like all tools, the question is <em>when</em>. The signals that it's time to split are concrete, not theoretical: <span class="diff-added">your deploy pipeline takes forty minutes because a test suite touches everything, two teams are consistently blocked on the same module and can't parallelize, or a single component has genuinely different scaling characteristics from the rest of your system (e.g., a video transcoding pipeline running alongside a CRUD app).</span></p>

        <p>Notice that all of these are <em>problems you actually have</em>, not problems you might have someday. The early-stage CTO's job is to maximize the rate of learning, and you learn faster when you can deploy in minutes, debug with a single stack trace, and onboard a new engineer without a three-day tour of your infrastructure.</p>
      </div>

      <!-- Comment Gutter -->
      <div class="comment-gutter">
        <div class="comment-bubble" style="top: 158px;">
          <div class="comment-author">
            <span class="author-you">You</span>
            <span class="comment-tag tag-todo">TODO</span>
          </div>
          <div class="comment-text">I need to find the exact number of services we had — check old architecture doc in Notion</div>
          <div class="comment-time">2 hours ago</div>
        </div>

        <div class="comment-bubble agent" style="top: 390px;">
          <div class="comment-author">
            <span class="author-agent">Agent</span>
            <span class="comment-tag tag-agent">@agent</span>
          </div>
          <div class="comment-text">This paragraph does a lot of heavy lifting. Consider splitting into two: one about the context-switching cost, one about the speed comparison. The Rails monolith example could be its own beat.</div>
          <div class="comment-time">12 min ago</div>
          <div class="comment-resolve">✓ Resolve</div>
        </div>

        <div class="comment-bubble" style="top: 590px;">
          <div class="comment-author">
            <span class="author-you">You</span>
          </div>
          <div class="comment-text">The finale needs to be stronger. @agent can you suggest a closing paragraph that ties back to the "forty-three users" opening?</div>
          <div class="comment-time">Just now</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Chat / Agent Pane -->
  <div class="resize-handle chat-handle" id="chatHandle"></div>
  <div class="chat-pane" id="chatPane">
    <div class="chat-header">
      <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--terminal-dim);">Terminal</span>
      <span class="model-indicator">
        via <span class="model-name">claude-code</span>
      </span>
    </div>

    <div class="chat-messages">
      <div class="chat-msg user">
        <div class="msg-label">You</div>
        <div class="msg-content">
          <p>Run the "tighten" skill on the full document. Remove hedging and filler words.</p>
        </div>
      </div>

      <div class="chat-msg agent">
        <div class="msg-label">Agent</div>
        <div class="msg-content">
          <p>Creating snapshot before edits...</p>
          <p style="color: var(--terminal-green);">✓ Snapshot 12 saved</p>
          <p>Reading why-monoliths-win.md (2,847 words)</p>
          <p>Scanning for hedging and filler...</p>
          <p>Found 4 passages to tighten.</p>
          <p style="margin-top: 6px;">Edit 1/4: ¶1 — removed "that would make their investors weep" → "terrifying"</p>
          <p>Edit 2/4: ¶3 — changed "six things" → "multiple things"</p>
          <p>Edit 3/4: ¶6 — condensed opening sentence, removed hedging</p>
          <p>Edit 4/4: ¶7 — removed "Notice that" filler</p>
          <p style="margin-top: 6px; color: var(--terminal-green);">✓ 4 edits applied. −67 words, +38 words.</p>
          <p style="color: var(--terminal-green);">✓ Snapshot 13 saved</p>
        </div>
      </div>

      <div class="chat-msg user">
        <div class="msg-label">You</div>
        <div class="msg-content">
          <p>Undo edit 1 — I like "make their investors weep" as a phrase.</p>
        </div>
      </div>

      <div class="chat-msg agent">
        <div class="msg-label">Agent</div>
        <div class="msg-content">
          <p>Reverted edit 1. Restored original phrasing in ¶1.</p>
          <p style="color: var(--terminal-green);">✓ Snapshot 14 saved</p>
        </div>
      </div>

      <div class="chat-msg user">
        <div class="msg-label">You</div>
        <div class="msg-content">
          <p>Now process the @agent comments — there's one about splitting a paragraph and one asking for a stronger closing.</p>
        </div>
      </div>

      <div class="agent-thinking">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        Reading comments file... processing 2 tagged items
      </div>
    </div>

    <div class="chat-input-area">
      <div class="chat-input-wrap">
        <textarea rows="1" placeholder="Ask the agent anything about your document..."></textarea>
        <button class="chat-send-btn">↑</button>
      </div>
      <div class="chat-input-hints">
        <span><kbd>⏎</kbd> send</span>
        <span><kbd>⇧⏎</kbd> newline</span>
        <span><kbd>⌘K</kbd> skills</span>
      </div>
    </div>
  </div>

</div>

<!-- Status Bar -->
<div class="statusbar">
  <span class="status-item git-branch">⎇ main</span>
  <span class="status-item">why-monoliths-win.md</span>
  <span class="status-item word-count">2,847 words · ~12 min read</span>
  <span class="status-item">Markdown</span>
  <span class="snapshot-status">● Snapshot 12 · 4 min ago</span>
</div>

<script>
(function() {
  const editor = document.getElementById('editorPane');
  const chat = document.getElementById('chatPane');
  const chatHandle = document.getElementById('chatHandle');

  // Editor ↔ Chat
  chatHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startEditorW = editor.getBoundingClientRect().width;
    const startChatW = chat.getBoundingClientRect().width;
    document.body.classList.add('resizing');
    chatHandle.classList.add('active');

    function onMove(e) {
      const dx = e.clientX - startX;
      const newEditorW = startEditorW + dx;
      const newChatW = startChatW - dx;

      if (newEditorW >= 400 && newChatW >= 240) {
        editor.style.flex = 'none';
        editor.style.width = newEditorW + 'px';
        chat.style.flex = 'none';
        chat.style.width = newChatW + 'px';
      }
    }

    function onUp() {
      document.body.classList.remove('resizing');
      chatHandle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();
</script>

</body>
</html>
