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


const selectLang = document.getElementById('select-lang');

function loadUsers() {
  const fs = require("fs");
  const path = require("path");
  const dataPath = path.join(__dirname, 'assets/data');

  if (!fs.existsSync(dataPath)) {
    console.warn('Data path does not exist:', dataPath);
    return;
  }

  const userDirs = fs.readdirSync(dataPath).filter(file => fs.lstatSync(path.join(dataPath, file)).isDirectory());

  const chatContainer = document.querySelector(".chats-container");
  chatContainer.innerHTML = '';

  userDirs.forEach(dir => {
    const userPath = path.join(dataPath, dir);
    const infoPath = path.join(userPath, 'info.json');
    const chatsPath = path.join(userPath, 'chats.json');

    if (fs.existsSync(infoPath)) {
      const userInfo = JSON.parse(fs.readFileSync(infoPath));
      let lastMessage = '';
      let lastMessageDate = '';

      if (fs.existsSync(chatsPath)) {
        const chats = JSON.parse(fs.readFileSync(chatsPath));
        if (Array.isArray(chats) && chats.length > 0) {
          lastMessage = chats[chats.length - 1].message || '';
          lastMessageDate = chats[chats.length - 1].date || '';
        }
      }

      const chatElement = document.createElement('div');
      chatElement.className = 'chat';
      chatElement.id = `chat_${userInfo.uid}`;
      chatElement.dataset.uid = userInfo.uid;
      chatElement.innerHTML = `
                  <div class="title">
                    <h3>${userInfo.nickname}</h3>
                  </div>
                  <div class="last-message">
                    <span class="date">${lastMessageDate}</span>
                    <span class="message">${lastMessage || 'No messages yet.'}</span>
                  </div>
            `;
      chatContainer.appendChild(chatElement);
    }
  });
}


window.addEventListener("DOMContentLoaded", function () {
  console.log("DOM fully loaded and parsed");

  if (currentLang == 'ru') {
    selectLang.options[1].selected = true;
  } else {
    selectLang.options[0].selected = true;
  }

  loadUsers();
});


const BUTTONS = Object.freeze({
  confirmNewUser: document.querySelector(".create-new-user-window #upd-save"),
})


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



const chatContainer = document.querySelector(".chats-container");

chatContainer.addEventListener("click", function (event) {
  const chat = event.target.closest(".chat");

  if (chat && chatContainer.contains(chat)) {
    console.log("Нашёл чат:", chat.id, chat.dataset.uid);

    const userId = chat.dataset.uid;
    const fs = require("fs");
    const path = require("path");
    const dataPath = path.join(__dirname, 'assets/data', `user_${chat.querySelector('.title h3').textContent}`);
    const chatsPath = path.join(dataPath, 'chats.json');

    if (!fs.existsSync(chatsPath)) {
      console.warn('No chats.json file found for user:', chat.querySelector('.title h3').textContent);
      return;
    }

    const messages = JSON.parse(fs.readFileSync(chatsPath));

    const chatSection = document.querySelector(".default-section.chat");
    const chatHeader = chatSection.querySelector(".name-logo h1");
    const messagesContainer = chatSection.querySelector(".messages");

    chatHeader.textContent = `${chat.querySelector('.title h3').textContent}`;
    messagesContainer.innerHTML = "";

    const messagesLengthEl = chatSection.querySelector(".messages-counter");
    messagesLengthEl.innerHTML = `Messages: <span class="msg-counter">${messages.length}</span>`;


    messages.forEach(msg => {
      const msgDiv = document.createElement("div");
      msgDiv.className = msg.from === 'you' ? 'message sent' : 'message received';
      msgDiv.innerHTML = `
            <p>${msg.message}</p>
            <span class="date">${msg.date}</span>
          `;
      msgDiv.setAttribute("data-from", msg.from);
      messagesContainer.appendChild(msgDiv);
    });

    switchWindow("*", "section.chat", "isActive");
  }
});


BUTTONS.confirmNewUser.addEventListener("click", function () {
  const nickname = document.querySelector(".create-new-user-window .nickname").value;
  const tag = document.querySelector(".create-new-user-window .tag").value;
  const userid = document.querySelector(".create-new-user-window .userid").value;
  const phone = document.querySelector(".create-new-user-window .phone-number").value;
  const typeSelect = document.querySelector(".create-new-user-window #upd-type");
  const type = typeSelect.options[typeSelect.selectedIndex].value;
  const isBlockedSelect = document.querySelector(".create-new-user-window #upd-blocked");
  const isBlocked = isBlockedSelect.options[isBlockedSelect.selectedIndex].value;

  if (nickname.length < 5) return;

  if (userid.length < 4) return;

  if (phone.length < 5) return;



  Assets.execute({
    type: "folder",
    data: {
      folder: { name: `user_${nickname}` },
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

  showNotification({
    title: "Success",
    context: `User ${nickname} created successfully.`,
    actions: [{ title: 'Ok', fn: () => { } }],
    timeout: 5
  });

  switchWindow(['.create-new-user-window'], null);
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


/*

showNotification({
  title: 'test',
  context: 'test context',
  actions: [{ title: 'action 1', fn: () => console.log('action 1-1') }],
  timeout: 10
});

*/
