const CONFIG = {
  animations: {
    notifications: {
      isActive: false,
      vars: {
        init: null
      },
      time: 10
    }
  }
}

const animatedBg = document.querySelector(".setting-item .animated-bg");
let isRenderingUsers = false;
let openChatPeerId = null;
let openChatTimer = null;
const chatContainer = document.querySelector(".chats-container");
const chatSection = document.querySelector(".default-section.chat");
const chatHeader = chatSection.querySelector(".name-logo h1");
const messagesWrap = chatSection.querySelector(".messages");
const messagesCount = chatSection.querySelector(".messages-counter");

const output = document.querySelector('.default-section.chat .output .asset');
const outputWin = document.querySelector('.default-section.chat .output');
messagesWrap.addEventListener("click", function (event) {
  event.preventDefault();
  const t = event.target.closest('img');
  console.log(t);

  if (t?.tagName === 'IMG') {
    output.innerHTML = `<img src="${t.src}">`;
    outputWin.classList.remove("hidden");
  } else return;
});

q('.output .close-btn').addEventListener("click", function () {
  outputWin.classList.add("hidden");
  output.innerHTML = `<img src="#">`;
});

// по каждому чату запоминаем последний отрисованный message.id
const lastRenderedMsgIdByPeer = new Map();
const selectLang = document.getElementById('select-lang');
const { ipcRenderer } = require("electron");
const { pathToFileURL } = require('url');
const MEDIA_ROOT = path.join(__dirname, 'assets', 'data', 'media');

function existsNonEmptyDir(dir) {
  try { return fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0; }
  catch { return false; }
}

function audioMimeByExt(p) {
  const n = p.toLowerCase();
  if (n.endsWith('.ogg') || n.endsWith('.oga')) return 'audio/ogg; codecs=opus';
  if (n.endsWith('.opus')) return 'audio/ogg; codecs=opus'; // Chrome ок, Safari — нет
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (n.endsWith('.wav')) return 'audio/wav';
  if (n.endsWith('.m4a')) return 'audio/mp4';
  return 'audio/ogg; codecs=opus';
}

function resolveLocalAudio(peerId, msg) {
  const dir = path.join(MEDIA_ROOT, String(peerId));
  if (!existsNonEmptyDir(dir)) return null;

  // 1) прямой путь, если нормализация его сохранила
  if (msg.media?.path && fs.existsSync(msg.media.path)) {
    return msg.media.path;
  }

  // 2) поиск по имени из msg.media.name / file_name
  const files = fs.readdirSync(dir);
  const nameCandidates = [];
  if (msg.media?.name) nameCandidates.push(String(msg.media.name));
  if (msg.media?.file_name) nameCandidates.push(String(msg.media.file_name));
  if (msg.id != null) nameCandidates.push(String(msg.id));

  const exts = ['.ogg', '.oga', '.opus', '.mp3', '.wav', '.m4a'];
  for (const f of files) {
    const lf = f.toLowerCase();
    // exact name
    for (const cand of nameCandidates) {
      if (!cand) continue;
      const lcand = cand.toLowerCase();
      if (lf === lcand) {
        return path.join(dir, f);
      }
      if (lf.includes(lcand)) {
        return path.join(dir, f);
      }
    }
    // contains id
    if (msg.id != null && lf.includes(String(msg.id))) {
      // ensure extension is audio
      if (exts.some(e => lf.endsWith(e))) return path.join(dir, f);
      // allow common voice prefixes too
      if (lf.includes('voice') || lf.includes('audio')) return path.join(dir, f);
    }
    // common prefixes with id (voice_12345.ogg etc)
    if (msg.id != null) {
      const id = String(msg.id);
      for (const pref of ['voice_', 'audio_', 'media_', 'file_', 'doc_', 'round_']) {
        for (const ext of exts) {
          if (lf === `${pref}${id}${ext}`) return path.join(dir, f);
        }
      }
    }
  }

  return null;
}

const runDurationAnimation = (el, _time) => {
  if (_time <= 0) return;

  const mm = Math.floor(_time / 60);
  const ss = Math.floor(_time % 60).toString().padStart(2, '0');
  el.textContent = `${mm}:${ss}`;

  setTimeout(() => {
    runDurationAnimation(el, _time);
  }, 1000);
  _time--;
}

function renderAudioBubble(user, msg, audioPath) {
  const fileUrl = pathToFileURL(audioPath).href;
  const type = audioMimeByExt(audioPath);
  // console.log(pathToFileURL(audioPath))

  const div = document.createElement('div');
  div.className = msg.dir === 'out' ? 'message sent' : 'message received audio';
  div.innerHTML = `
    <div class="voice-bubble">
      <button class="play-btn" title="Play/Pause"><i class="fa fa-play" aria-hidden="true"></i></button>
      <audio preload="none">
        <source src="${fileUrl}" type="${type}">
      </audio>
      <span class="date">${msg.ts || ''}</span>
      <span class="duration">0:00</span>
    </div>`;

  const btn = div.querySelector('.play-btn');
  const audio = div.querySelector('audio');
  const durEl = div.querySelector('.duration');

  audio.addEventListener('loadedmetadata', () => {
    const total = audio.duration; // float, секунды
    const mm = Math.floor(total / 60);
    const ss = Math.floor(total % 60).toString().padStart(2, '0');
    durEl.textContent = `${mm}:${ss}`;
  });


  btn.onclick = async () => {
    try {
      if (audio.paused) {
        await audio.play();
        btn.classList.add('playing');
        runDurationAnimation(div.querySelector(".duration"), audio.duration);
        btn.querySelector('i').className = 'fa fa-stop-circle';
        audio.addEventListener("ended", function () {
          btn.querySelector("i").className = 'fa fa-play';
        })
      } else {
        audio.pause();
        btn.classList.remove('playing');
        btn.querySelector('i').className = 'fa fa-play-circle';
      }
    } catch (e) {
      console.warn('audio play failed:', e);
    }
  };

  return div;
}

// если файла ещё нет — кнопка «скачать» через IPC, потом подмена
function renderLazyAudioBubble(user, msg) {
  const div = document.createElement('div');
  div.className = msg.dir === 'out' ? 'message sent' : 'message received';
  div.innerHTML = `
    <div class="file-bubble">
      <button class="download-btn">Download audio</button>
      <span class="date">${msg.ts || ''}</span>
    </div>`;

  const btn = div.querySelector('.download-btn');
  btn.onclick = async () => {
    try {
      const res = await ipcRenderer.invoke('media:download', {
        peerId: user.peerId || user.uid || user.id,
        messageId: msg.id
      });
      if (res?.ok && res.path) {
        // заменяем текущую «заглушку» на полноценный аудио-блок
        const audioNode = renderAudioBubble(user, msg, res.path);
        div.replaceWith(audioNode);
      } else {
        alert(res?.error || 'Download failed');
      }
    } catch (e) {
      console.error('download ipc failed:', e);
    }
  };

  return div;
}

// utils
function findUserByUid(uid) {
  if (!Array.isArray(listenerOutputData)) return null;
  uid = String(uid);
  return listenerOutputData.find(
    u => String(u.uid) === uid || String(u.peerId) === uid
  ) || null;
}




function guessKindFromName(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png') || n.endsWith('.webp') || n.endsWith('.gif')) return 'image';
  if (n.endsWith('.mp3') || n.endsWith('.wav') || n.endsWith('.ogg') || n.endsWith('.m4a')) return 'audio';
  if (n.endsWith('.mp4') || n.endsWith('.webm') || n.endsWith('.mkv') || n.endsWith('.mov')) return 'video';
  return 'file';
}

function resolveLocalMedia(peerId, msg) {
  const peerDir = path.join(MEDIA_ROOT, String(peerId));
  if (!existsNonEmptyDir(peerDir)) return null;

  // 1) прямой путь из msg.media.path
  if (msg.media && msg.media.path && fs.existsSync(msg.media.path)) {
    const kind = msg.type === 'photo' || msg.type === 'sticker' ? 'image'
      : msg.type === 'voice' ? 'audio'
        : msg.type === 'video' ? 'video'
          : guessKindFromName(msg.media.path);
    return { kind, filePath: msg.media.path };
  }

  const files = fs.readdirSync(peerDir).map(f => ({ name: f, lower: f.toLowerCase() }));

  // 2) совпадение по полному имени из msg.media.name / file_name
  const mediaName = msg.media?.name || msg.media?.file_name || null;
  if (mediaName) {
    const nameLower = String(mediaName).toLowerCase();
    const exact = files.find(f => f.lower === nameLower);
    if (exact) return { kind: guessKindFromName(exact.name), filePath: path.join(peerDir, exact.name) };
    const incl = files.find(f => f.lower.includes(nameLower));
    if (incl) return { kind: guessKindFromName(incl.name), filePath: path.join(peerDir, incl.name) };
  }

  // 3) поиск по id в имени файла
  if (msg.id != null) {
    const idStr = String(msg.id);
    const byId = files.find(f => f.lower.includes(idStr));
    if (byId) return { kind: guessKindFromName(byId.name), filePath: path.join(peerDir, byId.name) };
  }

  // 4) прежняя логика: шаблоны startsWith
  const bases = [];
  if (msg.id != null) {
    if (msg.type) bases.push(`${msg.type}_${msg.id}`);
    bases.push(`media_${msg.id}`, `file_${msg.id}`, `doc_${msg.id}`, `photo_${msg.id}`, `voice_${msg.id}`, `round_${msg.id}`, `video_${msg.id}`);
  }

  const cand = files.find(f => bases.some(b => f.name.startsWith(b)));
  if (cand) return { kind: guessKindFromName(cand.name), filePath: path.join(peerDir, cand.name) };

  // 5) как fallback: если msg.media содержит "file_name" с расширением, попробуем найти файл с тем же расширением
  if (msg.media?.file_name) {
    const ext = path.extname(String(msg.media.file_name)).toLowerCase();
    const byExt = files.find(f => f.lower.endsWith(ext));
    if (byExt) return { kind: guessKindFromName(byExt.name), filePath: path.join(peerDir, byExt.name) };
  }

  return null;
}

function renderMessageWithMedia(user, msg) {
  const div = document.createElement('div');
  div.className = msg.dir === 'out' ? 'message sent' : 'message received';

  // если это чистый текст — просто показываем
  const isTextOnly = msg.type === 'text' && (!msg.media);
  if (isTextOnly && msg.text) {
    div.innerHTML = `<p>${msg.text}</p><span class="date">${msg.ts || ''}</span>`;
    return div;
  }

  // иначе пробуем найти медиа локально
  const media = resolveLocalMedia(user.peerId || user.uid || user.id, msg);

  if (!media) {
    // медиа нет локально — покажем текст, если есть, иначе "[media]"
    const fallback = msg.text && msg.text.trim() ? msg.text : '[media]';
    div.innerHTML = `<p>${fallback}</p><span class="date">${msg.ts || ''}</span>`;
    return div;
  }

  const url = pathToFileURL(media.filePath).href;
  // рендер в зависимости от вида
  if (media.kind === 'image') {
    div.innerHTML = `
      <div class="image-bubble">
        <img src="${url}" alt="image"/>
        <span class="date">${msg.ts || ''}</span>
      </div>`;
    return div;
  }
  console.log(media)
  if (media.kind === 'audio') {
    div.innerHTML = `
      <div class="voice-bubble">
        <button class="play-btn" title="Play/Pause"></button>
        <audio preload="none" src="${url}"></audio>
        <span class="date">${msg.ts || ''}</span>
      </div>`;
    const btn = div.querySelector('.play-btn');
    const audio = div.querySelector('audio');
    btn.onclick = () => {
      if (audio.paused) { audio.play(); btn.classList.add('playing'); }
      else { audio.pause(); btn.classList.remove('playing'); }
    };
    return div;
  }

  if (media.kind === 'video') {
    div.innerHTML = `
      <div class="video-bubble">
        <video src="${url}" controls playsinline></video>
        <span class="date">${msg.ts || ''}</span>
      </div>`;
    return div;
  }

  // file/unknown
  const label = (msg.media && msg.media.name) ? msg.media.name : media.filePath.split(path.sep).pop();
  div.innerHTML = `
    <div class="file-bubble">
      <a href="${url}" download="${label}">${label}</a>
      <span class="date">${msg.ts || ''}</span>
    </div>`;
  return div;
}

function loadUpdateWindow(data = {}) {
  const container = document.querySelector(".update-container");
  if (!container) return;

  const setInput = (selector, value) => {
    const el = container.querySelector(selector);
    if (!el) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      el.value = value ?? '';
    } else {
      el.textContent = value ?? '';
    }
  };

  setInput('.update-container .nickname', data.nickname ?? '<no name>');
  setInput('.update-container .tag', data.tag ?? '');
  setInput('.update-container .userid', data.userid ?? '');
  setInput('.update-container .usr-title', data.userid ?? '');
  setInput('.update-container .phone-number', data.phone ?? '');
  setInput('.update-container #upd-type', data.type ?? 'user');
  setInput('.update-container #upd-blocked', data.isBlocked ?? 'not-blocked');
  setInput('.update-container #about', data.about ?? '');

  const typeSelect = container.querySelector('#upd-type');
  if (typeSelect && data.type) {
    Array.from(typeSelect.options).forEach(opt => { opt.selected = opt.value === data.type; });
  }
  const blockedSelect = container.querySelector('#upd-blocked');
  if (blockedSelect && data.isBlocked) {
    Array.from(blockedSelect.options).forEach(opt => { opt.selected = opt.value === data.isBlocked; });
  }
}

const tableContent = document.querySelector('.dashboard .table-content');

tableContent.addEventListener("click", function (event) {
  event.preventDefault();

  const uidEl = event.target.closest('[data-uid]');
  const uid = uidEl ? uidEl.dataset.uid : undefined;
  window.uid = uid;

  if (!uid) {
    console.warn('No uid found on clicked element');
    return;
  }

  try {
    const infoPath = path.join(__dirname, 'assets', 'data', uid, 'info.json');

    if (!fs.existsSync(infoPath)) {
      console.warn('info.json not found for uid:', uid);
      return;
    }

    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

    loadUpdateWindow(info);

    switchWindow([], '.create-new-user-window');

  } catch (err) {
    console.error('Failed to load user data for uid:', uid, err);
  }
});

const USERS_FILE = path.join(__dirname, "assets", "data", "logs.json");

let listenerOutput = 0;
let listenerOutputData = [];

function startUsersWatcher() {
  setInterval(() => {
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf8");
      const users = JSON.parse(raw);
      listenerOutputData = users;

      if (Array.isArray(users)) {
        const totalMessages = users.reduce((acc, u) => acc + (Array.isArray(u.messages) ? u.messages.length : 0), 0);

        if (totalMessages !== listenerOutput && !isRenderingUsers) {
          isRenderingUsers = true;
          listenerOutput = totalMessages;
          loadUsers(true);
          // маленькая задержка, чтобы пачка изменений не вызвала флэппинг
          setTimeout(() => { isRenderingUsers = false; }, 100);
        }
      }
    } catch (err) {
      console.warn("Ошибка чтения logs.json:", err);
    }
  }, 2000);
}


async function loadChat(peer, limit = 200) {
  const res = await ipcRenderer.invoke('chat:fetchHistory', { peer, limit });
  if (!res?.ok) {
    console.warn('chat:fetchHistory error:', res?.error);
    return;
  }

  mergeConversation(res.convo);

  // ✅ очистим список перед перерисовкой, чтобы не копилось
  loadUsers(true);

  // Если сейчас открыт этот чат — дозальём новые сообщения
  if (openChatPeerId === String(res.convo.peerId)) {
    const fresh = findUserByUid(res.convo.peerId);
    if (fresh) appendNewMessages(fresh);
  }
}

function loadUsers(cleanTable = false) {
  if (!Array.isArray(listenerOutputData) || listenerOutputData.length === 0) return;

  if (cleanTable) {
    if (chatContainer) chatContainer.innerHTML = '';
    if (tableContent) tableContent.innerHTML = '';
  }

  listenerOutputData.forEach(user => {
    const chatElement = document.createElement('div');
    chatElement.className = 'chat';
    chatElement.id = `chat_${user.peerId}`;
    chatElement.dataset.uid = user.peerId;
    let latestMessage;
    let from;
    user.messages.forEach(msg => {
      if (msg.ts === user.lastTs) latestMessage = `${msg.text}`;
      from = `${msg.dir === 'in' ? user.username || user.name : messages[currentLang].chat.from_you}`;
    })
    chatElement.innerHTML = `
                  <div class="title">
                    <h3>${user.name}</h3>
                  </div>
                  <div class="last-message">
                    <span class="date">${user.lastTs}</span>
                    <span class="message"><strong>${from}</strong>: ${latestMessage}</span>
                  </div>
            `;
    chatContainer.appendChild(chatElement);

  });

  if (tableContent) {
    listenerOutputData.forEach((data, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
                      <td>${index + 1}</td>
                      <td title="${data.peerId}">${data.peerId || '<none>'}</td>
                      <td title="${data.name}">${data.name || '<unknow>'}</td>
                      <td title="${data.username}">${data.username}</td>
                      <td title="${data.messages[0].ts}">${data.messages[0].ts || '<unknow>'}</td>
                      <td title="${data.messages.length}">${data.messages.length}</td>
                      <td title="${data.messages[data.messages.length - 1].ts}">${data.messages[data.messages.length - 1].ts}</td>
                      <td class="show-update hidden-easy" data-uid="${data.peerId}">
                        ${messages[currentLang].table.update_btn}
                      </td>
                `;
      tableContent.appendChild(row);
    })
  }

  const usersBar = document.querySelector(".stats .count");
  usersBar.textContent = listenerOutputData.length;
}


function loadAccountData() {
  const envPath = path.join(__dirname.replace('\\src', '\\'), '.env');

  if (!fs.existsSync(envPath)) {
    console.warn('No .env file found at:', envPath);
    return {};
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  const data = {};

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    data[key] = rest.join('=');
  });

  q('.default-section.accounts .table-content .api_id').textContent = data['API_ID'];
  q('.default-section.accounts .table-content .api_id').title = data['API_ID'];
  q('.default-section.accounts .table-content .api_hash').textContent = data['API_HASH'];
  q('.default-section.accounts .table-content .api_hash').title = data['API_HASH'];
  q('.default-section.accounts .table-content .phone_number').textContent = data['PHONE'];
  q('.default-section.accounts .table-content .phone_number').title = data['PHONE'];
  q('.default-section.accounts .table-content .tg_session').textContent = data['SESSION_FILE'];
  q('.default-section.accounts .table-content .logged_in').textContent = new Date().toLocaleString();
}

window.addEventListener("DOMContentLoaded", function () {
  if (currentLang == 'ru') {
    selectLang.options[1].selected = true;
  } else {
    selectLang.options[0].selected = true;
  }

  if (this.localStorage.getItem('isAnime') != null) {
    animatedBg.checked = this.localStorage.getItem('isAnime') === 'true' ? true : false;

    if (animatedBg.checked == true) {
      q('header').style.backgroundImage = 'url(assets/bg/animation.gif)';
    }
  }

  loadAccountData();
  startUsersWatcher();
});


const BUTTONS = Object.freeze({
  confirmNewUser: document.querySelector(".create-new-user-window #upd-save"),
  confirmNewAcc: document.querySelector('.create-account-win #upd-save'),
});

function q(t) {
  return document.querySelector(t);
}


BUTTONS.confirmNewAcc.addEventListener("click", function () {
  const Dir_path = path.join(__dirname.replace('\\src', '')) + '\\.tg_session';
  const inputs = {
    phone: q('.create-account-win .form .phone-number').value,
    API_ID: q('.create-account-win .form .API_ID').value,
    API_HASH: q('.create-account-win .form .API_HASH').value,
    SESSION_FILE: '.tg_session'
  }

  fs.writeFileSync(Dir_path, `API_ID=${inputs.API_ID}\nAPI_HASH=${inputs.API_HASH}\nPHONE=${inputs.phone}\nSESSION_FILE=${inputs.SESSION_FILE}`);
});

const switchWindow = function (closedWindows = [], newWindowID, className = ["active", "isActive"]) {
  const removeClasses = (el, classes) => {
    if (!el) return;
    if (Array.isArray(classes)) {
      classes.forEach(c => el.classList.remove(c));
    } else {
      el.classList.remove(classes);
    }
  };

  const toggleClasses = (el, classes) => {
    if (!el) return;
    if (Array.isArray(classes)) {
      classes.forEach(c => el.classList.toggle(c));
    } else {
      el.classList.toggle(classes);
    }
  };

  if (Array.isArray(closedWindows) && closedWindows.length > 0) {
    closedWindows.forEach(selector => {
      const el = document.querySelector(selector);
      removeClasses(el, className);
    });
  }

  if (closedWindows === "*") {
    document.querySelectorAll("*").forEach(e => removeClasses(e, className));
  }

  if (newWindowID !== null) {
    const newWin = document.querySelector(newWindowID);
    toggleClasses(newWin, className);
  }
};



const table = document.querySelector('.table-content');

const tableAccount = document.querySelector('.default-section.accounts .content .table-content')

table.addEventListener("click", function (event) {
  event.preventDefault();

  if (event.target.classList.contains('show-update')) {
    switchWindow('*', '.update-container', "active");
  }
});

tableAccount.addEventListener("click", function (event) {
  event.preventDefault();
  if (event.target.classList.contains('show-update')) {
    switchWindow('*', '.default-section.accounts .update-container', "active");
  }
});

const closeUpdateBtn = document.querySelector('.update-container .close-btn');
closeUpdateBtn.addEventListener("click", function () {
  switchWindow(['.update-container'], null);
});

const closeUpdateBtnAccs = document.querySelector('.default-section.accounts .update-container .close-btn');
closeUpdateBtnAccs.addEventListener("click", function () {
  switchWindow(['.default-section.accounts .update-container'], null);
});


const openUserModal = document.querySelector('nav .account-side');
openUserModal.addEventListener("click", function (event) {
  event.preventDefault();
  if (event.target.className === 'avatar') {
    switchWindow([], 'nav .account-side .container');
  }
});

const createNewUsrBtn = document.querySelector("#add-new-user");
createNewUsrBtn.addEventListener("click", function () {
  switchWindow([], '.create-new-user-window');
});

const createNewAccBtn = document.querySelector("#add-new-account");
createNewAccBtn.addEventListener("click", function () {
  switchWindow([], '.create-account-win');
});

const closeNewUsrWin = document.querySelector(".create-new-user-window .close-btn");
closeNewUsrWin.addEventListener("click", function () {
  switchWindow(['.default-section.dashboard .create-new-user-window'], null);
});

const closeNewAccWin = document.querySelector(".create-account-win .close-btn");
closeNewAccWin.addEventListener("click", function () {
  switchWindow(['.default-section.accounts .create-account-win'], null);
});

const locationsPaths = document.querySelectorAll('.default-section');
const locationsBtn = document.querySelectorAll('.location-button');

locationsBtn.forEach(location => {
  location.addEventListener("click", function () {
    const path = this.dataset.location;
    locationsPaths.forEach(el => {
      if (el.dataset.path != path) el.classList.remove('isActive');
      else el.classList.add('isActive');
    });
  })
});


const notificationWin = document.querySelector(".notifications-window");
const notificationTitle = document.querySelector(".notifications-window .title");
const notificationContext = document.querySelector(".notifications-window .context");
const notificationActions = document.querySelector(".notifications-window .actions");
const notificationTimeout = document.querySelector(".notifications-window .timeout");

const showNotification = function (object) {
  if (!object) return;

  CONFIG.animations.notifications.time = 10;
  notificationTitle.textContent = object.title;
  notificationContext.textContent = object.context;

  if (object.actions !== null && Array.isArray(object.actions) && object.actions.length > 0) {
    if (object.actions.length > 0) {
      object.actions.forEach(act => {
        const btn = document.createElement("button");
        btn.textContent = act.title;
        btn.addEventListener("click", function () {
          if (typeof act.fn === "function") act.fn();
        });
        notificationActions.append(btn);
      });
    }
  } else {
    notificationActions.innerHTML = "";
  }

  notificationWin.classList.add("active");

  CONFIG.animations.notifications.vars.init = setInterval(() => {
    if (CONFIG.animations.notifications.time <= 0) {
      clearInterval(CONFIG.animations.notifications.vars.init);
      notificationWin.classList.remove("active");
      notificationTitle.textContent = "";
      notificationTimeout.textContent = "10";
      notificationContext.textContent = "";
      notificationActions.innerHTML = "";
      CONFIG.animations.notifications.time = 10;
      return;
    }

    notificationTimeout.textContent = CONFIG.animations.notifications.time;
    CONFIG.animations.notifications.time--;
  }, 1000);
}

notificationWin.addEventListener("mousemove", function () {
  CONFIG.animations.notifications.time = 10;
  clearInterval(CONFIG.animations.notifications.vars.init);
});

notificationWin.addEventListener("mouseout", function () {
  CONFIG.animations.notifications.vars.init = setInterval(() => {
    if (CONFIG.animations.notifications.time <= 0) {
      clearInterval(CONFIG.animations.notifications.vars.init);
      notificationWin.classList.remove("active");
      notificationTitle.textContent = "";
      notificationTimeout.textContent = "10";
      notificationContext.textContent = "";
      notificationActions.innerHTML = "";
      CONFIG.animations.notifications.time = 10;
      return;
    }

    notificationTimeout.textContent = CONFIG.animations.notifications.time;
    CONFIG.animations.notifications.time--;
  }, 1000);
});



const showAsideBtn = document.querySelector(".show-menu");
const aside = document.querySelector("aside");

showAsideBtn.addEventListener("click", function () {
  aside.classList.toggle("on-active");
});


let openChatLastCount = 0;

function findUserByUid(uid) {
  if (!Array.isArray(listenerOutputData)) return null;
  return listenerOutputData.find(
    u => String(u.uid) === String(uid) || String(u.peerId) === String(uid)
  ) || null;
}

function renderMessage(user, msg) {
  // текстовые — как раньше
  if ((!msg.type || msg.type === 'text') && msg.text) {
    const div = document.createElement('div');
    div.className = msg.dir === 'out' ? 'message sent' : 'message received';
    div.innerHTML = `<p>${msg.text}</p><span class="date">${msg.ts || ''}</span>`;
    return div;
  }

  // AUDIO / voice — сначала пробуем локальный файл, иначе рендерим «скачать»
  if (msg.type === 'voice' || (msg.media && (msg.type === 'voice' || String(msg.media.name || '').toLowerCase().includes('voice')))) {
    const p = resolveLocalAudio(user.peerId || user.uid || user.id, msg);
    if (p) return renderAudioBubble(user, msg, p);
    return renderLazyAudioBubble(user, msg);
  }

  // Остальные медиа — попробуем найти локально и отрисовать в зависимости от типа
  const media = resolveLocalMedia(user.peerId || user.uid || user.id, msg);
  if (media) {
    const url = pathToFileURL(media.filePath).href;
    if (media.kind === 'image') {
      const div = document.createElement('div');
      div.className = msg.dir === 'out' ? 'message sent' : 'message received';
      div.innerHTML = `
        <div class="image-bubble">
          <img src="${url}" alt="image"/>
          <span class="date">${msg.ts || ''}</span>
        </div>`;
      return div;
    }
    if (media.kind === 'audio') {
      const div = document.createElement('div');
      div.className = msg.dir === 'out' ? 'message sent' : 'message received';
      div.innerHTML = `
        <div class="voice-bubble">
          <button class="play-btn" title="Play/Pause"></button>
          <audio preload="none" src="${url}"></audio>
          <span class="date">${msg.ts || ''}</span>
        </div>`;
      const btn = div.querySelector('.play-btn');
      const audio = div.querySelector('audio');
      btn.onclick = () => {
        if (audio.paused) { audio.play(); btn.classList.add('playing'); }
        else { audio.pause(); btn.classList.remove('playing'); }
      };
      return div;
    }
    if (media.kind === 'video') {
      const div = document.createElement('div');
      div.className = msg.dir === 'out' ? 'message sent' : 'message received';
      div.innerHTML = `
        <div class="video-bubble">
          <video src="${url}" controls playsinline></video>
          <span class="date">${msg.ts || ''}</span>
        </div>`;
      return div;
    }
    // file/unknown
    const label = (msg.media && (msg.media.name || msg.media.file_name)) ? (msg.media.name || msg.media.file_name) : media.filePath.split(path.sep).pop();
    const div = document.createElement('div');
    div.className = msg.dir === 'out' ? 'message sent' : 'message received';
    div.innerHTML = `
      <div class="file-bubble">
        <a href="${url}" download="${label}">${label}</a>
        <span class="date">${msg.ts || ''}</span>
      </div>`;
    return div;
  }

  // Если медиа не найдено локально — показываем кнопку загрузки для аудио или fallback для прочего
  if (msg.media) {
    // если похоже на аудио — предложим скачать
    if ((msg.media.name && String(msg.media.name).toLowerCase().includes('voice')) || msg.type === 'voice') {
      return renderLazyAudioBubble(user, msg);
    }
    // иначе покажем хоть название файла вместо '[media]'
    const label = msg.media.name || msg.media.file_name || '[media]';
    const div = document.createElement('div');
    div.className = msg.dir === 'out' ? 'message sent' : 'message received';
    div.innerHTML = `<p>${label}</p><span class="date">${msg.ts || ''}</span>`;
    return div;
  }

  // Всё остальное: текст отсутствует и медиа не найдено
  const div = document.createElement('div');
  div.className = msg.dir === 'out' ? 'message sent' : 'message received';
  const fallback = (msg.text && msg.text.trim()) ? msg.text : '[media]';
  div.innerHTML = `<p>${fallback}</p><span class="date">${msg.ts || ''}</span>`;
  return div;
}


function renderAllMessages(user) {
  messagesWrap.innerHTML = "";
  const arr = user.messages || [];
  for (const m of arr) {
    messagesWrap.appendChild(renderMessage(user, m));
  }
  messagesCount.innerHTML = `Messages: <span class="msg-counter">${arr.length}</span>`;
  // запомнить последний id
  const last = arr[arr.length - 1];
  lastRenderedMsgIdByPeer.set(String(user.peerId || user.uid), last ? last.id ?? arr.length : 0);
  // проскроллить вниз
  messagesWrap.scrollTop = messagesWrap.scrollHeight;
}


function appendNewMessages(user) {
  const peerKey = String(user.peerId || user.uid);
  const lastId = lastRenderedMsgIdByPeer.get(peerKey) ?? 0;
  const arr = user.messages || [];
  if (!arr.length) return;

  let appended = 0;
  for (const m of arr) {
    const mid = (m.id != null) ? m.id : -1;
    const isNew = (mid !== -1) ? (mid > lastId) : false;

    if (mid === -1) {
      const already = messagesWrap.children.length;
      for (let i = already; i < arr.length; i++) {
        messagesWrap.appendChild(renderMessage(user, arr[i]));
        appended++;
      }
      break;
    } else if (isNew) {
      const nearBottom = (messagesWrap.scrollTop + messagesWrap.clientHeight) >= (messagesWrap.scrollHeight - 16);
      messagesWrap.appendChild(renderMessage(user, m));
      appended++;
      if (nearBottom) messagesWrap.scrollTop = messagesWrap.scrollHeight;
    }
  }

  if (appended) {
    // обновим lastId
    const last = arr[arr.length - 1];
    const newLastId = (last && last.id != null) ? last.id : (arr.length);
    lastRenderedMsgIdByPeer.set(peerKey, newLastId);
    messagesCount.innerHTML = `Messages: <span class="msg-counter">${arr.length}</span>`;
  }
}

function startChatUpdater() {
  if (openChatTimer) {
    clearInterval(openChatTimer);
    openChatTimer = null;
  }
  openChatTimer = setInterval(() => {
    if (!openChatPeerId) return;
    const fresh = findUserByUid(openChatPeerId);
    if (!fresh) return;
    appendNewMessages(fresh);
  }, 1000);
}

function startChatUpdater() {
  if (openChatTimer) {
    clearInterval(openChatTimer);
    openChatTimer = null;
  }

  openChatTimer = setInterval(() => {
    if (!openChatPeerId) return;
    const fresh = findUserByUid(openChatPeerId);
    if (!fresh) return;
    appendNewMessages(fresh);
  }, 1000);
}

chatContainer.addEventListener("click", async (e) => {
  const chat = e.target.closest(".chat");
  if (!chat || !chatContainer.contains(chat)) return;

  const uid = String(chat.dataset.uid || chat.id);
  if (!uid) return;

  if (openChatPeerId === uid) {
    switchWindow("*", "section.chat", "isActive");
    return;
  }

  const user = findUserByUid(uid);
  if (!user) {
    console.warn("User not found for uid:", uid);
    return;
  }

  chatHeader.textContent = user.username || user.name || "<no name>";
  openChatPeerId = uid;
  renderAllMessages(user);

  switchWindow("*", "section.chat", "isActive");
  startChatUpdater();
  document.querySelector('.chat .messages').scrollBy(0, new Date().getTime())
});




BUTTONS.confirmNewUser.addEventListener("click", function () {
  const nickname = document.querySelector(".create-new-user-window .nickname").value || '<no name>';
  const tag = document.querySelector(".create-new-user-window .tag").value;
  const userid = document.querySelector(".create-new-user-window .userid").value;
  const phone = document.querySelector(".create-new-user-window .phone-number").value;
  const typeSelect = document.querySelector(".create-new-user-window #upd-type");
  const type = typeSelect.options[typeSelect.selectedIndex].value;
  const isBlockedSelect = document.querySelector(".create-new-user-window #upd-blocked");
  const isBlocked = isBlockedSelect.options[isBlockedSelect.selectedIndex].value;



  Assets.execute({
    type: "folder",
    data: {
      folder: { name: new Date().getTime() },
      files: [
        {
          name: "info.json", content: {
            nickname: nickname,
            tag: tag,
            userid: userid,
            phone: phone,
            type: type,
            isBlocked: isBlocked,
            createdAt: new Date().toLocaleString(),
            uid: new Date().getTime()
          }
        },
        { name: "accounts.json", content: [] },
        { name: "chats.json", content: [] },
        { name: "logs.json", content: [] }
      ]
    }
  });

  switchWindow(['.create-new-user-window'], null);

  setTimeout(() => {
    loadUsers(true);
  }, 1000);
});




selectLang.addEventListener('change', function () {
  const selectedLang = this.value;
  localStorage.setItem('lang', selectedLang === 'English' ? 'en' : 'ru');

  showNotification({
    title: messages[currentLang].notificationsMessages.language_changed,
    context: messages[currentLang].notificationsMessages.restart_app,
    actions: [{ title: messages[currentLang].notificationsMessages.refresh_btn, fn: () => location.reload() }],
    timeout: 10
  });

  applyTranslations();
});




animatedBg.addEventListener("change", function () {
  localStorage.setItem('isAnime', this.checked);
  if (this.checked === true) {
    q('header').style.backgroundImage = 'url(assets/bg/animation.gif)';
  } else {
    q('header').style.backgroundImage = 'none';
  }
});

/*

showNotification({
  title: 'test',
  context: 'test context',
  actions: [{ title: 'action 1', fn: () => console.log('action 1-1') }],
  timeout: 10
});

*/
