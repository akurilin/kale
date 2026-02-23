//
// This file centralizes the typed preload bridge contract for the isolated
// terminal view so terminal session IPC can evolve without touching editor code.
//

import type {
  ResizeTerminalSessionRequest,
  StartTerminalSessionRequest,
  StartTerminalSessionResponse,
  TerminalSessionActionResponse,
  TerminalBootstrapResponse,
  TerminalProcessDataEvent,
  TerminalProcessExitEvent,
} from '../shared-types';

type TerminalApi = {
  getBootstrapContext: () => Promise<TerminalBootstrapResponse>;
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
