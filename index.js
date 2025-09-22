// main.js
const { app, BrowserWindow, Menu, Tray } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

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
    this.baseDir = path.join(__dirname + '/src', "assets", "data");
    this.files = ["logs.txt", "users.json", "accounts.json", "system.json"];
    this.ensureStorage();
  }

  ensureStorage() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (!fs.existsSync('src/assets/sessions')) {
      fs.mkdirSync('src/assets/sessions', { recursive: true });
    }

    if (!fs.existsSync('src/assets/sessioins/main.json')) fs.writeFileSync('src/assets/sessions/main.json', "[]");

    for (const f of this.files) {
      const full = path.join(this.baseDir, f);
      if (!fs.existsSync(full)) {
        if (full.includes('.txt')) {
          fs.writeFileSync(full, "");
        } else {
          fs.writeFileSync(full, "[]");
        }
      }
    }
  }

  _full(file) {
    return path.join(this.baseDir, file);
  }

  read(file) {
    try {
      const raw = fs.readFileSync(this._full(file), "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  write(file, data) {
    fs.writeFileSync(this._full(file), JSON.stringify(data ?? [], null, 2));
  }

  append(file, entry) {
    const data = this.read(file);
    data.push(entry);
    this.write(file, data);
  }
}

const storage = new DataManager();

let tray = null;
let win = null;

const trayMenu = Menu.buildFromTemplate([
  {
    label: "Exit",
    click: () => app.quit(),
  },
]);

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icons", "icon.ico");
  tray = new Tray(iconPath);
  tray.setToolTip("Telegram Logger v1.0");
  tray.setContextMenu(trayMenu);

  tray.on("click", () => {
    if (win && !win.isDestroyed()) {
      win.focus();
      return;
    }
    createWindow();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300,
    height: 900,
    show: true,
    icon: path.join(__dirname, "assets", "icons", "icon.ico"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  //   win.removeMenu();
  win.loadFile(path.join(__dirname, "src/index.html"));

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createTray();

  storage.append("start.json", {
    pc: os.hostname(),
    username: os.userInfo().username,
    startedAt: new Date().toISOString(),
    ip: getLocalIPv4(),
  });
});

app.on("window-all-closed", () => { });
