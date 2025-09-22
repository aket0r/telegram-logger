// index.js (main)
const { app, BrowserWindow, Menu, Tray, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const USERS_FILE = path.join(__dirname, "src/assets/data/logs.json");
const ERROR_LOG = path.join(__dirname, "src/assets/data/logs.txt");

function logError(err) {
  const entry = {
    ts: new Date().toLocaleString(),
    message: err?.message || String(err),
    stack: err?.stack || null
  };

  // пишем JSON одной строкой + перенос
  fs.appendFileSync(ERROR_LOG, JSON.stringify(entry) + "\n", "utf8");
}

function watchUsersFile(win) {
  fs.watchFile(USERS_FILE, { interval: 1000 }, () => {
    console.log("users.json изменился, отправляю в renderer...");
    try {
      win.webContents.send("users:changed");
    } catch (e) {
      console.error(e);
      logError(e);
    }
  });
}




function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "0.0.0.0";
}

class DataManager {
  constructor() {
    this.baseDir = path.join(__dirname, "src", "assets", "data");
    this.files = ["start.json", "logs.json"];
    this.ensureStorage();
  }
  ensureStorage() {
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });

    const sessionsDir = path.join(__dirname, "src", "assets", "sessions");
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    const mainSession = path.join(sessionsDir, "main.json");
    if (!fs.existsSync(mainSession)) fs.writeFileSync(mainSession, "[]");

    for (const f of this.files) {
      const full = this._full(f);
      if (!fs.existsSync(full)) fs.writeFileSync(full, f.endsWith(".txt") ? "" : "[]");
    }
  }
  _full(file) { return path.join(this.baseDir, file); }
  read(file) {
    try {
      const raw = fs.readFileSync(this._full(file), "utf8");
      return file.endsWith(".txt") ? raw : JSON.parse(raw);
    } catch { return file.endsWith(".txt") ? "" : []; }
  }
  write(file, data) {
    const full = this._full(file);
    if (file.endsWith(".txt")) fs.writeFileSync(full, String(data ?? ""));
    else fs.writeFileSync(full, JSON.stringify(data ?? [], null, 2));
  }
  append(file, entry) {
    if (file.endsWith(".txt")) {
      const prev = this.read(file);
      const line = typeof entry === "string" ? entry : JSON.stringify(entry);
      this.write(file, prev ? prev + "\n" + line : line);
    } else {
      const data = this.read(file);
      data.push(entry);
      this.write(file, data);
    }
  }
}

const storage = new DataManager();

let tray = null;
let win = null;

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icons", "icon.ico");
  tray = new Tray(iconPath);

  const trayMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        win.show();
      },
    },
    {
      label: "Exit",
      click: () => {
        app.isQuiting = true; // 👈 ставим флаг
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Telegram Logger v1.0");
  tray.setContextMenu(trayMenu);

  tray.on("click", () => {
    win.isVisible() ? win.hide() : win.show();
  });
}


function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 900,
    show: true,
    icon: path.join(__dirname, "assets", "icons", "icon.ico"),
    webPreferences: {
      // оставляем как было у тебя
      nodeIntegration: true,
      contextIsolation: false,
    },
    // resizable: false,
    // frame: false,
    // titleBarStyle: 'hidden'
  });

  win.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win.hide();
    }
  });

  // сначала показываем экран авторизации
  win.loadFile(path.join(__dirname, "src", "auth.html"));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  createTray();
  createWindow();
  watchUsersFile(win);

  // стартовый лог
  storage.append("start.json", {
    pc: os.hostname(),
    username: os.userInfo().username,
    startedAt: new Date().toISOString(),
    ip: getLocalIPv4(),
  });

  // запускаем MTProto и даём ему доступ к окну для IPC
  const { startTelegram } = require("./telegram"); // файл из корня
  startTelegram(win);

  // когда auth-UI говорит «готово», грузим основной интерфейс
  ipcMain.on("auth:load-main", () => {
    if (win && !win.isDestroyed()) {
      win.loadFile(path.join(__dirname, "src", "index.html"));
    }
  });
});

// остаёмся жить в трее
app.on("window-all-closed", () => { /* noop */ });
