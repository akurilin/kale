//
// Main-process spellcheck service. Registers the IPC handler for adding
// words to the OS dictionary — the only spellcheck operation that requires
// main-process authority (session API). All other spellcheck work happens
// in the preload/renderer via webFrame.
//

import { session, type IpcMain } from 'electron';

export const registerSpellcheckIpcHandlers = (ipcMain: IpcMain) => {
  ipcMain.handle(
    'spellcheck:add-to-dictionary',
    (_event, word: string): boolean => {
      return session.defaultSession.addWordToSpellCheckerDictionary(word);
    },
  );
};
