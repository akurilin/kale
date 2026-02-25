//
// This component provides a reusable PTY-backed terminal pane that can be
// embedded in larger layouts while staying focused on one file context.
//

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLatestRef } from './use-latest-ref';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import type {
  StartTerminalSessionResponse,
  TerminalProcessExitEvent,
} from '../shared-types';
import { getTerminalApi } from './terminal-api';

type TerminalSessionState = {
  sessionId: string;
  pid: number;
  command: string;
  args: string[];
};

type TerminalPaneProps = {
  targetFilePath: string | null;
  targetWorkingDirectory: string | null;
  contextSourceLabel?: string | null;
  title?: string;
  showPrototypeNotice?: boolean;
  showMetadataPanel?: boolean;
};

type TerminalPromptPreset = {
  label: string;
  promptText: string;
};

const terminalPromptPresets: TerminalPromptPreset[] = [
  {
    label: 'Fix grammar',
    promptText: "fix this document's grammar",
  },
  {
    label: 'Handle comments',
    promptText:
      "Look at each individual comment currently in this document and address its concerns, then remove the comment once you're done.",
  },
  {
    label: 'Generate comments',
    promptText:
      'Generate comments with ideas for improving the readability of this document.',
  },
  {
    label: 'Analyze flow',
    promptText:
      'Analyze the document and provide feedback on the overall structure and flow, and critique how the flow of the whole document could be improved if there are any suggestions.',
  },
];

// This helper derives a stable file-context key so the pane can ignore content
// reloads for the same file while still restarting when the user switches files.
const buildTargetContextKey = (
  targetFilePath: string | null,
  targetWorkingDirectory: string | null,
) => {
  if (!targetFilePath || !targetWorkingDirectory) {
    return null;
  }

  return `${targetFilePath}::${targetWorkingDirectory}`;
};

export const TerminalPane = ({
  targetFilePath,
  targetWorkingDirectory,
  contextSourceLabel = null,
  title = 'Terminal',
  showPrototypeNotice = false,
  showMetadataPanel = true,
}: TerminalPaneProps) => {
  const [session, setSession] = useState<TerminalSessionState | null>(null);
  const [workingDirectoryInput, setWorkingDirectoryInput] = useState('');
  const [statusText, setStatusText] = useState('Waiting for file context...');
  const [launchErrorText, setLaunchErrorText] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);

  const terminalHostElementRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSessionState | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // useLatestRef keeps these mirrors current on every render so async flows
  // and event handlers always see the latest value without effect churn.
  const isStartingSessionRef = useLatestRef(isStartingSession);
  const workingDirectoryInputRef = useLatestRef(workingDirectoryInput);
  const lastActivatedTargetContextKeyRef = useRef<string | null>(null);
  const activeTargetFilePathRef = useLatestRef(targetFilePath);
  const activeTargetWorkingDirectoryRef = useLatestRef(targetWorkingDirectory);

  // sessionRef is kept as a manual ref because restartForTargetContext writes
  // it imperatively (before the React render cycle) to prevent delayed exit
  // events from the old process from overwriting the next session's state.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // The xterm instance is imperative and owns terminal rendering/input, while
  // React owns the surrounding layout and file-context lifecycle behavior.
  useEffect(() => {
    const hostElement = terminalHostElementRef.current;
    if (!hostElement) {
      return;
    }

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#151515',
        foreground: '#e6e3da',
      },
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostElement);
    fitAddon.fit();
    terminal.focus();
    terminal.writeln('kale terminal');
    terminal.writeln('');

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const xtermInputDisposable = terminal.onData((data) => {
      const activeSessionId = sessionRef.current?.sessionId;
      if (!activeSessionId) {
        return;
      }

      void getTerminalApi().sendInput(activeSessionId, data);
    });

    // PTY geometry must track xterm size so full-screen TUIs and wrapping stay
    // correct when the pane is resized by layout changes or window resizing.
    const syncPtySizeToActiveSession = async () => {
      const activeSessionId = sessionRef.current?.sessionId;
      if (!activeSessionId) {
        return;
      }

      const columns = terminal.cols;
      const rows = terminal.rows;
      if (columns <= 0 || rows <= 0) {
        return;
      }

      await getTerminalApi().resizeSession({
        sessionId: activeSessionId,
        cols: columns,
        rows,
      });
    };

    const refitTerminalAndSyncPty = () => {
      fitAddon.fit();
      void syncPtySizeToActiveSession();
    };

    const resizeObserver = new ResizeObserver(() => {
      refitTerminalAndSyncPty();
    });
    resizeObserver.observe(hostElement);

    return () => {
      resizeObserver.disconnect();
      xtermInputDisposable.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Streamed process events are global to the window, so the pane filters by
  // active session id and ignores traffic for prior or sibling terminal panes.
  useEffect(() => {
    const removeProcessDataListener = getTerminalApi().onProcessData(
      (event) => {
        if (event.sessionId !== sessionRef.current?.sessionId) {
          return;
        }

        xtermRef.current?.write(event.chunk);
      },
    );

    const removeProcessExitListener = getTerminalApi().onProcessExit(
      (event: TerminalProcessExitEvent) => {
        if (event.sessionId !== sessionRef.current?.sessionId) {
          return;
        }

        setSession(null);
        setStatusText(
          event.signal !== null
            ? `Terminal exited (signal ${event.signal})`
            : `Terminal exited (code ${event.exitCode ?? 'unknown'})`,
        );
        xtermRef.current?.writeln('');
        xtermRef.current?.writeln(
          event.signal !== null
            ? `[process exited: signal ${event.signal}]`
            : `[process exited: code ${event.exitCode ?? 'unknown'}]`,
        );
      },
    );

    return () => {
      removeProcessDataListener();
      removeProcessExitListener();
    };
  }, []);

  // Releasing the active PTY on unmount prevents background CLI processes from
  // being orphaned when this pane is removed or the app switches routes/views.
  useEffect(() => {
    return () => {
      const activeSessionId = sessionRef.current?.sessionId;
      if (!activeSessionId) {
        return;
      }

      void getTerminalApi().killSession(activeSessionId);
    };
  }, []);

  // The working-directory editor follows the active file context by default so
  // users get sensible CLI startup behavior without manual path entry first.
  useEffect(() => {
    if (!targetWorkingDirectory) {
      return;
    }

    setWorkingDirectoryInput(targetWorkingDirectory);
    if (!targetFilePath) {
      setStatusText('Waiting for file context...');
      return;
    }

    setStatusText('Ready to start terminal');
  }, [targetWorkingDirectory, targetFilePath]);

  // The start response drives status UI and the active session id used to route
  // streamed PTY output into this pane's xterm instance.
  const handleStartSessionResponse = useCallback(
    (startResponse: StartTerminalSessionResponse) => {
      if (!startResponse.ok) {
        setStatusText('Failed to start terminal');
        setLaunchErrorText(startResponse.errorMessage);
        xtermRef.current?.writeln('');
        xtermRef.current?.writeln(
          `[launch failed] ${startResponse.command} ${startResponse.args.join(' ')}`.trim(),
        );
        xtermRef.current?.writeln(startResponse.errorMessage);
        xtermRef.current?.writeln('');
        return;
      }

      setSession({
        sessionId: startResponse.sessionId,
        pid: startResponse.pid,
        command: startResponse.command,
        args: startResponse.args,
      });
      setStatusText(`Running (pid ${startResponse.pid})`);
      xtermRef.current?.writeln('');
      xtermRef.current?.writeln(
        `[session started] ${startResponse.command} ${startResponse.args.join(' ')}`.trim(),
      );
      xtermRef.current?.writeln(`[cwd] ${startResponse.cwd}`);
      xtermRef.current?.writeln(`[target] ${startResponse.targetFilePath}`);
      xtermRef.current?.writeln('');
      fitAddonRef.current?.fit();
      void getTerminalApi().resizeSession({
        sessionId: startResponse.sessionId,
        cols: xtermRef.current?.cols ?? 120,
        rows: xtermRef.current?.rows ?? 40,
      });
    },
    [],
  );

  // This helper centralizes session start behavior so file-change auto-restart
  // and manual restart actions follow the same PTY lifecycle and status logic.
  const startSessionForTargetContext = useCallback(
    async (requestedWorkingDirectory?: string) => {
      const currentTargetFilePath = activeTargetFilePathRef.current;
      const currentTargetWorkingDirectory =
        activeTargetWorkingDirectoryRef.current;
      if (!currentTargetFilePath || !currentTargetWorkingDirectory) {
        return;
      }

      if (isStartingSessionRef.current || sessionRef.current) {
        return;
      }

      setIsStartingSession(true);
      setLaunchErrorText(null);
      setStatusText('Starting terminal...');

      const normalizedRequestedWorkingDirectory =
        requestedWorkingDirectory?.trim() ??
        workingDirectoryInputRef.current.trim();
      try {
        const startResponse = await getTerminalApi().startSession({
          cwd:
            normalizedRequestedWorkingDirectory ||
            currentTargetWorkingDirectory,
          targetFilePath: currentTargetFilePath,
        });
        handleStartSessionResponse(startResponse);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown terminal start error';
        setStatusText('Failed to start terminal');
        setLaunchErrorText(errorMessage);
        xtermRef.current?.writeln('');
        xtermRef.current?.writeln(`[launch failed] IPC request rejected`);
        xtermRef.current?.writeln(errorMessage);
        xtermRef.current?.writeln('');
      } finally {
        setIsStartingSession(false);
      }
    },
    [handleStartSessionResponse],
  );

  // File switches should produce a clean CLI session in the new file's folder,
  // so this effect tears down any active session and starts a fresh one per file.
  useEffect(() => {
    const nextTargetContextKey = buildTargetContextKey(
      targetFilePath,
      targetWorkingDirectory,
    );
    if (!nextTargetContextKey) {
      return;
    }

    if (lastActivatedTargetContextKeyRef.current === nextTargetContextKey) {
      return;
    }

    lastActivatedTargetContextKeyRef.current = nextTargetContextKey;
    let isCancelled = false;

    const restartForTargetContext = async () => {
      const previousSession = sessionRef.current;
      if (previousSession) {
        // Clear the local active-session ref first so delayed exit events from
        // the old process cannot overwrite state for the next started session.
        sessionRef.current = null;
        setSession(null);
        setStatusText('Switching terminal context...');
        await getTerminalApi().killSession(previousSession.sessionId);
      }

      if (isCancelled) {
        return;
      }

      xtermRef.current?.clear();
      xtermRef.current?.writeln('[terminal reset for file]');
      xtermRef.current?.writeln(targetFilePath ?? '');
      xtermRef.current?.writeln('');

      await startSessionForTargetContext(targetWorkingDirectory ?? undefined);
    };

    void restartForTargetContext();

    return () => {
      isCancelled = true;
    };
  }, [targetFilePath, targetWorkingDirectory, startSessionForTargetContext]);

  // Preset buttons automate common Claude-in-terminal requests by writing a
  // full prompt plus Enter into the already-running PTY session.
  const sendPresetPromptToActiveSession = useCallback(
    async (promptText: string) => {
      const activeSessionId = sessionRef.current?.sessionId;
      if (!activeSessionId) {
        return;
      }

      await getTerminalApi().sendInput(activeSessionId, promptText);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
      await getTerminalApi().sendInput(activeSessionId, '\r');
      xtermRef.current?.focus();
    },
    [],
  );

  return (
    <section className="pane terminal-pane">
      <div className="pane-title">{title}</div>
      {showPrototypeNotice ? (
        <div className="terminal-warning-banner">
          Phase 1 terminal prototype: PTY-backed CLI process in a chosen working
          directory, rendered with xterm.js.
        </div>
      ) : null}
      {showMetadataPanel ? (
        <div className="terminal-metadata-grid terminal-metadata-grid--embedded">
          <div className="terminal-cwd-editor-cell">
            <label className="terminal-metadata-label" htmlFor="terminal-cwd">
              start cwd
            </label>
            <input
              id="terminal-cwd"
              className="terminal-input terminal-cwd-input"
              type="text"
              value={workingDirectoryInput}
              onChange={(event) => {
                setWorkingDirectoryInput(event.target.value);
              }}
              disabled={!!session || isStartingSession}
              placeholder={targetWorkingDirectory ?? '/path/to/folder'}
            />
          </div>
          <div>
            <span className="terminal-metadata-label">cwd</span>
            <span className="terminal-metadata-value">
              {targetWorkingDirectory ?? '...'}
            </span>
          </div>
          <div>
            <span className="terminal-metadata-label">target file</span>
            <span className="terminal-metadata-value">
              {targetFilePath
                ? contextSourceLabel
                  ? `${targetFilePath} (${contextSourceLabel})`
                  : targetFilePath
                : '...'}
            </span>
          </div>
          <div>
            <span className="terminal-metadata-label">status</span>
            <span className="terminal-metadata-value">{statusText}</span>
          </div>
          <div>
            <span className="terminal-metadata-label">process</span>
            <span className="terminal-metadata-value">
              {session
                ? `${session.command} ${session.args.join(' ')} (pid ${session.pid})`
                : 'process (not running)'}
            </span>
          </div>
          <div>
            <span className="terminal-metadata-label">launch error</span>
            <span className="terminal-metadata-value">
              {launchErrorText ?? 'none'}
            </span>
          </div>
        </div>
      ) : null}
      <div className="terminal-output terminal-output--pane">
        <div className="terminal-xterm-host" ref={terminalHostElementRef} />
      </div>
      <div className="terminal-preset-bar" aria-label="Terminal prompt presets">
        {terminalPromptPresets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="terminal-preset-button"
            disabled={!session}
            title={preset.promptText}
            onClick={() => {
              void sendPresetPromptToActiveSession(preset.promptText);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
};
