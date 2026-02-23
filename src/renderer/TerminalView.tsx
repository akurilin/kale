//
// This view exists so we can iterate on PTY terminal integration in isolation
// without coupling to the editor view while the IPC contract settles.
//

import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from 'xterm';

import type {
  StartTerminalSessionResponse,
  TerminalBootstrapResponse,
} from '../shared-types';
import { getTerminalApi } from './terminal-api';

type TerminalSessionState = {
  sessionId: string;
  pid: number;
  command: string;
  args: string[];
};

// The terminal view manages one process session at a time because Phase 1
// testing is focused on proving one PTY shell terminal in a chosen folder first.
export const TerminalView = () => {
  const [bootstrapContext, setBootstrapContext] =
    useState<TerminalBootstrapResponse | null>(null);
  const [session, setSession] = useState<TerminalSessionState | null>(null);
  const [workingDirectoryInput, setWorkingDirectoryInput] = useState('');
  const [statusText, setStatusText] = useState('Loading terminal context...');
  const [launchErrorText, setLaunchErrorText] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);

  const terminalHostElementRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSessionState | null>(null);
  const hasAttemptedAutoStartRef = useRef(false);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // The xterm instance is imperative and owns terminal rendering/input, while
  // React owns the surrounding layout and process lifecycle controls.
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
    terminal.writeln('kale terminal prototype (xterm.js)');
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

  // A ref mirror keeps event handlers synced with the latest session without
  // resubscribing IPC listeners on every state change.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // The isolated terminal view needs bootstrap context from main because main
  // owns the authoritative file path/settings resolution logic.
  useEffect(() => {
    let isDisposed = false;

    const loadBootstrapContext = async () => {
      try {
        const nextBootstrapContext =
          await getTerminalApi().getBootstrapContext();
        if (isDisposed) {
          return;
        }

        setBootstrapContext(nextBootstrapContext);
        setWorkingDirectoryInput(nextBootstrapContext.cwd);
        setStatusText('Ready to start terminal');
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setStatusText('Failed to load terminal context');
        setLaunchErrorText(
          error instanceof Error ? error.message : 'Unknown bootstrap error',
        );
        xtermRef.current?.writeln(
          `\r\n[bootstrap failed] ${error instanceof Error ? error.message : 'Unknown bootstrap error'}`,
        );
      }
    };

    void loadBootstrapContext();

    return () => {
      isDisposed = true;
    };
  }, []);

  // Streamed process events stay global to the window, so we filter by the
  // active session id in the renderer and ignore stale session traffic.
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
      (event) => {
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

  // Autostart matches the integration doc's isolated-view workflow so running
  // with `VITE_KALE_VIEW=terminal` is enough to begin testing immediately.
  useEffect(() => {
    if (!bootstrapContext || hasAttemptedAutoStartRef.current) {
      return;
    }

    hasAttemptedAutoStartRef.current = true;
    void (async () => {
      await startSessionForCurrentBootstrapContext(
        bootstrapContext,
        bootstrapContext.cwd,
      );
    })();
  }, [bootstrapContext]);

  // This launcher centralizes process start behavior so auto-start and manual
  // restart buttons follow the exact same session lifecycle.
  const startSessionForCurrentBootstrapContext = async (
    currentBootstrapContext: TerminalBootstrapResponse,
    requestedWorkingDirectory?: string,
  ) => {
    if (isStartingSession || sessionRef.current) {
      return;
    }

    setIsStartingSession(true);
    setLaunchErrorText(null);
    setStatusText('Starting terminal...');

    const normalizedRequestedWorkingDirectory =
      requestedWorkingDirectory?.trim() ?? workingDirectoryInput.trim();
    try {
      const startResponse = await getTerminalApi().startSession({
        cwd: normalizedRequestedWorkingDirectory || currentBootstrapContext.cwd,
        targetFilePath: currentBootstrapContext.targetFilePath,
      });
      handleStartSessionResponse(startResponse);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown terminal start error';
      setStatusText('Failed to start terminal');
      setLaunchErrorText(errorMessage);
      xtermRef.current?.writeln('');
      xtermRef.current?.writeln(`[launch failed] IPC request rejected`);
      xtermRef.current?.writeln(errorMessage);
      xtermRef.current?.writeln('');
    } finally {
      setIsStartingSession(false);
    }
  };

  // The start response drives both status UI and the active-session id used to
  // route streamed process events back into this view.
  const handleStartSessionResponse = (
    startResponse: StartTerminalSessionResponse,
  ) => {
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
  };

  // Ctrl+C is the fastest manual recovery action when a terminal process blocks,
  // so the prototype exposes it even before xterm keyboard emulation.
  const sendInterruptSignal = async () => {
    if (!session) {
      return;
    }

    const sendResponse = await getTerminalApi().sendInput(
      session.sessionId,
      '\u0003',
    );
    if (!sendResponse.ok) {
      setStatusText('Failed to send input');
      xtermRef.current?.writeln(
        `\r\n[input send failed] ${sendResponse.errorMessage ?? 'Unknown error'}`,
      );
    }
  };

  // Explicit stop keeps the prototype predictable during iteration and avoids
  // leaving background processes running when restarting the terminal view.
  const stopSession = async () => {
    if (!session) {
      return;
    }

    setStatusText('Stopping terminal...');
    await getTerminalApi().killSession(session.sessionId);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-title">kale terminal view</div>
        <button
          className="topbar-button"
          type="button"
          disabled={!bootstrapContext || !!session || isStartingSession}
          onClick={() => {
            if (!bootstrapContext) {
              return;
            }

            void startSessionForCurrentBootstrapContext(bootstrapContext);
          }}
        >
          {isStartingSession ? 'Starting...' : 'Start'}
        </button>
        <button
          className="topbar-button"
          type="button"
          disabled={!session}
          onClick={() => {
            void stopSession();
          }}
        >
          Stop
        </button>
        <button
          className="topbar-button"
          type="button"
          disabled={!session}
          onClick={() => {
            void sendInterruptSignal();
          }}
        >
          Ctrl+C
        </button>
        <button
          className="topbar-button"
          type="button"
          onClick={() => {
            xtermRef.current?.clear();
            xtermRef.current?.writeln('[terminal cleared]');
          }}
        >
          Clear
        </button>
        <div className="file-path">
          {bootstrapContext
            ? `${bootstrapContext.targetFilePath} (${bootstrapContext.source})`
            : ''}
        </div>
        <div className="save-status">{statusText}</div>
      </header>
      <main className="workspace">
        <section className="pane">
          <div className="pane-title">Terminal (Prototype)</div>
          <div className="terminal-warning-banner">
            Phase 1 terminal prototype: PTY-backed shell process in a chosen
            working directory, rendered with xterm.js. The sample markdown file
            directory is used as the default cwd.
          </div>
          <div className="terminal-metadata-grid">
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
                placeholder={bootstrapContext?.cwd ?? '/path/to/folder'}
              />
            </div>
            <div>
              <span className="terminal-metadata-label">cwd</span>
              <span className="terminal-metadata-value">
                {bootstrapContext?.cwd ?? '...'}
              </span>
            </div>
            <div>
              <span className="terminal-metadata-label">target file</span>
              <span className="terminal-metadata-value">
                {bootstrapContext?.targetFilePath ?? '...'}
              </span>
            </div>
            <div>
              <span className="terminal-metadata-label">process</span>
              <span className="terminal-metadata-value">
                {session
                  ? `${session.command} ${session.args.join(' ')} (pid ${session.pid})`
                  : 'shell (not running)'}
              </span>
            </div>
            <div>
              <span className="terminal-metadata-label">launch error</span>
              <span className="terminal-metadata-value">
                {launchErrorText ?? 'none'}
              </span>
            </div>
          </div>
          <div className="terminal-output">
            <div className="terminal-xterm-host" ref={terminalHostElementRef} />
          </div>
        </section>
      </main>
    </>
  );
};
