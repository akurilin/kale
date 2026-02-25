//
// This file centralizes the typed preload bridge contract for the IDE server
// integration so selection change events flow through one source of truth.
//

import type { IdeSelectionChangedEvent } from '../shared-types';

type IdeServerApi = {
  reportSelectionChanged: (event: IdeSelectionChangedEvent) => void;
};

declare global {
  interface Window {
    ideServerApi: IdeServerApi;
  }
}

// A single accessor keeps renderer components focused on UI logic instead of
// reaching into the browser global directly.
export const getIdeServerApi = (): IdeServerApi => window.ideServerApi;
