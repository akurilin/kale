import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';

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

// Startup dimensions should respect the active display work area so the app
// always opens fully on-screen even when defaults exceed the current display.
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

// Electron packager does not apply dock/taskbar icon metadata on Linux, so
// BrowserWindow needs an explicit PNG icon path for window-switcher rendering.
const resolveLinuxRuntimeWindowIconPath = () => {
  if (process.platform !== 'linux') {
    return undefined;
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }

  return path.resolve(__dirname, '../../assets/icons/icon.png');
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
    icon: resolveLinuxRuntimeWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Prevent the renderer from navigating away from the app. Without this guard
  // a rogue link click or programmatic navigation could load an arbitrary URL
  // inside a window that still has full preload bridge access.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Deny all attempts to open new browser windows (e.g. target="_blank" links).
  // This prevents untrusted content from spawning windows with inherited
  // Electron privileges.
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
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
