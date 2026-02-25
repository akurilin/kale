//
// Public API for the IDE integration server. The main process imports this
// module to start/stop the server and broadcast editor state notifications.
//

export { startIdeServer, type IdeServerHandle } from './websocket-server';
export type {
  EditorStateProvider,
  EditorSelection,
  OpenEditor,
  DiagnosticEntry,
  SelectionRange,
  JsonRpcNotification,
} from './types';
