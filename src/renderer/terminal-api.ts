//
// This file centralizes the typed preload bridge contract for terminal session
// control so terminal IPC can evolve without touching editor/editor-pane code.
//

import type {
  ResizeTerminalSessionRequest,
  StartTerminalSessionRequest,
  StartTerminalSessionResponse,
  TerminalSessionActionResponse,
  TerminalProcessDataEvent,
  TerminalProcessExitEvent,
} from '../shared-types';

type TerminalApi = {
  startSession: (
    request: StartTerminalSessionRequest,
  ) => Promise<StartTerminalSessionResponse>;
  sendInput: (
    sessionId: string,
    data: string,
  ) => Promise<TerminalSessionActionResponse>;
  resizeSession: (
    request: ResizeTerminalSessionRequest,
  ) => Promise<TerminalSessionActionResponse>;
  killSession: (sessionId: string) => Promise<TerminalSessionActionResponse>;
  onProcessData: (
    handler: (event: TerminalProcessDataEvent) => void,
  ) => () => void;
  onProcessExit: (
    handler: (event: TerminalProcessExitEvent) => void,
  ) => () => void;
};

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}

// A single accessor keeps terminal renderer components focused on UI logic
// instead of reaching into the browser global directly.
export const getTerminalApi = (): TerminalApi => window.terminalApi;
