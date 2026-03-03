//
// This file centralizes the typed preload bridge contract for window controls
// so renderer layout code can request native size changes through one boundary.
//

import type {
  AdjustWindowWidthRequest,
  AdjustWindowWidthResponse,
} from '../shared-types';

type WindowApi = {
  adjustWindowWidthBy: (
    request: AdjustWindowWidthRequest,
  ) => Promise<AdjustWindowWidthResponse>;
};

declare global {
  interface Window {
    windowApi: WindowApi;
  }
}

// A dedicated accessor keeps React layout components focused on behavior while
// this module owns typing for the browser-global preload bridge.
export const getWindowApi = (): WindowApi => window.windowApi;
