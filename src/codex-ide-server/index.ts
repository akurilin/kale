//
// Public API for the Codex IDE-context provider. Main owns its lifecycle while
// the protocol and payload details stay isolated from Electron orchestration.
//

export { buildCodexIdeContext, type CodexIdeContext } from './context';
export { startCodexIdeServer, type CodexIdeServerHandle } from './server';
