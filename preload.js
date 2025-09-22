// в рендерер-скрипте (у тебя nodeIntegration=true — можно напрямую)
const { contextBridge, ipcRenderer } = require("electron");
const logsList = document.getElementById("logs-list");

ipcRenderer.on("tg:new-log", (_e, rec) => {
    // Пример строки лога
    const li = document.createElement("li");
    li.textContent = `[${rec.ts}] [${rec.dir}] (${rec.chat}) ${rec.text}`;
    logsList.prepend(li); // наверх
});


contextBridge.exposeInMainWorld("api", {
    onUsersChanged: (cb) => ipcRenderer.on("users:changed", cb)
});
