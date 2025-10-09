const { contextBridge, ipcRenderer } = require("electron");
const logsList = document.getElementById("logs-list");

ipcRenderer.on("tg:new-log", (_e, rec) => {
    const li = document.createElement("li");
    li.textContent = `[${rec.ts}] [${rec.dir}] (${rec.chat}) ${rec.text}`;
    logsList.prepend(li);
});


contextBridge.exposeInMainWorld("api", {
    onUsersChanged: (cb) => ipcRenderer.on("users:changed", cb),
    fetchAvatar: (peer) => ipcRenderer.invoke('avatar:fetch', { peer }),
    onNewLog: (cb) => ipcRenderer.on('tg:new-log', (_e, rec) => cb(rec))
});
