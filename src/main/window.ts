import { BrowserWindow } from 'electron';
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

  const mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
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
