import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const BUNDLED_SAMPLE_MARKDOWN_FILE = path.resolve(
  app.getAppPath(),
  'data',
  'what-the-best-looks-like.md',
);
const DEFAULT_USER_FILE_NAME = 'what-the-best-looks-like.md';
const SETTINGS_FILE_NAME = 'settings.json';
const DEFAULT_WINDOW_WIDTH = 2560;
const DEFAULT_WINDOW_HEIGHT = 1440;
let currentMarkdownFilePath: string | null = null;

type AppSettings = {
  lastOpenedFilePath?: string;
};

type LoadMarkdownResponse = {
  content: string;
  filePath: string;
};

type OpenMarkdownFileResponse =
  | { canceled: true }
  | ({ canceled: false } & LoadMarkdownResponse);

const parseWindowDimension = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSettingsFilePath = () =>
  path.join(app.getPath('userData'), SETTINGS_FILE_NAME);

const readSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as AppSettings;
    return parsed ?? {};
  } catch {
    return {};
  }
};

const writeSettings = async (settings: AppSettings) => {
  const settingsPath = getSettingsFilePath();
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

const canReadFile = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const ensureDefaultUserFile = async () => {
  const targetFilePath = path.join(app.getPath('userData'), DEFAULT_USER_FILE_NAME);
  if (await canReadFile(targetFilePath)) {
    return targetFilePath;
  }

  await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
  try {
    const sampleContent = await fs.readFile(BUNDLED_SAMPLE_MARKDOWN_FILE, 'utf8');
    await fs.writeFile(targetFilePath, sampleContent, 'utf8');
  } catch {
    await fs.writeFile(targetFilePath, '', 'utf8');
  }

  return targetFilePath;
};

const setCurrentMarkdownFilePath = async (filePath: string) => {
  currentMarkdownFilePath = filePath;
  const settings = await readSettings();
  settings.lastOpenedFilePath = filePath;
  await writeSettings(settings);
};

const ensureCurrentMarkdownFilePath = async () => {
  if (currentMarkdownFilePath && (await canReadFile(currentMarkdownFilePath))) {
    return currentMarkdownFilePath;
  }

  const settings = await readSettings();
  if (settings.lastOpenedFilePath && (await canReadFile(settings.lastOpenedFilePath))) {
    currentMarkdownFilePath = settings.lastOpenedFilePath;
    return currentMarkdownFilePath;
  }

  const defaultFilePath = await ensureDefaultUserFile();
  await setCurrentMarkdownFilePath(defaultFilePath);
  return defaultFilePath;
};

const loadCurrentMarkdown = async (): Promise<LoadMarkdownResponse> => {
  const filePath = await ensureCurrentMarkdownFilePath();
  const content = await fs.readFile(filePath, 'utf8');
  return { content, filePath };
};

ipcMain.handle('editor:load-markdown', async () => {
  return loadCurrentMarkdown();
});

ipcMain.handle('editor:save-markdown', async (_event, content: string) => {
  const filePath = await ensureCurrentMarkdownFilePath();
  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true };
});

ipcMain.handle(
  'editor:open-markdown-file',
  async (): Promise<OpenMarkdownFileResponse> => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow ?? undefined, {
      title: 'Open Markdown File',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    await setCurrentMarkdownFilePath(filePath);
    return { canceled: false, content, filePath };
  },
);

const createWindow = () => {
  const windowWidth = parseWindowDimension(
    process.env.KALE_WINDOW_WIDTH,
    DEFAULT_WINDOW_WIDTH,
  );
  const windowHeight = parseWindowDimension(
    process.env.KALE_WINDOW_HEIGHT,
    DEFAULT_WINDOW_HEIGHT,
  );

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
