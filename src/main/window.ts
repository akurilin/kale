import { BrowserWindow, screen, type IpcMain } from 'electron';
import path from 'node:path';

import type {
  AdjustWindowWidthRequest,
  AdjustWindowWidthResponse,
} from '../shared-types';

const DEFAULT_WINDOW_WIDTH = 2560;
const DEFAULT_WINDOW_HEIGHT = 1440;

// Development visibility of DevTools is env-controlled so layout-sensitive UI
// bugs can be reproduced without the extra docked DevTools relayout.
const shouldOpenDevTools = (isHeadless: boolean) => {
  if (isHeadless) {
    return false;
  }

  return process.env.KALE_OPEN_DEVTOOLS === '1';
};

// Window sizing is environment-configurable in development so contributors can
// quickly test layouts without changing checked-in defaults.
const parseWindowDimension = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Startup dimensions should respect the active display work area so later
// width-delta toggles (like terminal collapse/expand) are computed from a
// realistic baseline instead of a size that is already off-screen.
const clampInitialWindowSizeToPrimaryDisplay = (
  requestedWidth: number,
  requestedHeight: number,
) => {
  const { width: maximumWidth, height: maximumHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(requestedWidth, maximumWidth),
    height: Math.min(requestedHeight, maximumHeight),
  };
};

// Window-size mutations must stay bounded by both the active display work area
// and BrowserWindow minimum constraints so layout toggles never push the app
// off-screen or below an unusable size.
const clampWindowWidthToSafeBounds = (
  browserWindow: BrowserWindow,
  requestedWidth: number,
) => {
  const [minimumWindowWidth] = browserWindow.getMinimumSize();
  const activeDisplay = screen.getDisplayMatching(browserWindow.getBounds());
  const maximumWindowWidth = activeDisplay.workArea.width;
  return Math.max(
    minimumWindowWidth,
    Math.min(maximumWindowWidth, requestedWidth),
  );
};

// Renderer layout measurements are reported in CSS pixels, but BrowserWindow
// sizing APIs use DIP units. This conversion keeps width adjustments accurate
// at non-default zoom factors (for example after Cmd+ plus/minus zoom changes).
const convertCssPixelDeltaToWindowPixelDelta = (
  cssPixelDelta: number,
  zoomFactor: number,
) => {
  const safeZoomFactor =
    Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return cssPixelDelta * safeZoomFactor;
};

// This handler lets renderer layout toggles adjust the native window width
// while keeping authority in main over clamping and per-window ownership.
export const registerWindowIpcHandlers = (ipcMain: IpcMain) => {
  ipcMain.handle(
    'window:adjust-width-by',
    async (
      event,
      request: AdjustWindowWidthRequest,
    ): Promise<AdjustWindowWidthResponse> => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      if (!browserWindow) {
        return {
          ok: false,
          appliedWidth: 0,
          appliedHeight: 0,
          wasClamped: false,
        };
      }

      const [currentWindowWidth, currentWindowHeight] = browserWindow.getSize();
      const zoomFactor = event.sender.getZoomFactor();
      const windowPixelDelta = convertCssPixelDeltaToWindowPixelDelta(
        request.deltaWidth,
        zoomFactor,
      );
      const requestedWindowWidth = Math.round(
        currentWindowWidth + windowPixelDelta,
      );
      const nextWindowWidth = clampWindowWidthToSafeBounds(
        browserWindow,
        requestedWindowWidth,
      );
      const wasClamped = nextWindowWidth !== requestedWindowWidth;

      if (nextWindowWidth !== currentWindowWidth) {
        browserWindow.setSize(nextWindowWidth, currentWindowHeight);
      }

      const [appliedWidth, appliedHeight] = browserWindow.getSize();
      return {
        ok: true,
        appliedWidth,
        appliedHeight,
        wasClamped,
      };
    },
  );
};

// The main process creates renderer windows so preload wiring and Forge/Vite
// entrypoint resolution stay centralized and consistent across app restarts.
export const createMainWindow = () => {
  // Headless mode hides the window and suppresses DevTools so E2E tests and CI
  // pipelines can drive the app without needing a visible display.
  const isHeadless = process.env.KALE_HEADLESS === '1';

  const windowWidth = parseWindowDimension(
    process.env.KALE_WINDOW_WIDTH,
    DEFAULT_WINDOW_WIDTH,
  );
  const windowHeight = parseWindowDimension(
    process.env.KALE_WINDOW_HEIGHT,
    DEFAULT_WINDOW_HEIGHT,
  );
  const { width: safeWindowWidth, height: safeWindowHeight } =
    clampInitialWindowSizeToPrimaryDisplay(windowWidth, windowHeight);

  const mainWindow = new BrowserWindow({
    width: safeWindowWidth,
    height: safeWindowHeight,
    show: !isHeadless,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // DevTools are opt-in because a docked DevTools window can trigger extra
  // startup relayouts that hide timing bugs in layout-sensitive components.
  if (shouldOpenDevTools(isHeadless)) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
};
