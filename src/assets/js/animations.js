const switchWindow = function(closedWindows = [], newWindowID) {
  if (Array.isArray(closedWindows) && closedWindows.length > 0) {
      closedWindows.forEach(element => {
          let el = document.querySelector(element);
          el.classList.remove("active");
      });
  }

  if (closedWindows === '*') {
      document.querySelectorAll('*').forEach(e => e.classList.remove('active'));
  }

  if (newWindowID !== null) {
      const newWin = document.querySelector(newWindowID);
      if (newWin.classList.contains('active')) {
        newWin.classList.remove('active');
      } else {
        newWin.classList.add('active');
      }
  }
}


const table = document.querySelector('.table-content');

const tableAccount = document.querySelector('.default-section.accounts .content .table-content')

table.addEventListener("click", function(event) {
    event.preventDefault();

    if (event.target.classList.contains('show-update')) {
        switchWindow('*', '.update-container');
    }
});

tableAccount.addEventListener("click", function(event) {
    event.preventDefault();
    if (event.target.classList.contains('show-update')) {
        switchWindow('*', '.default-section.accounts .update-container');
    }
});

const closeUpdateBtn = document.querySelector('.update-container .close-btn');
closeUpdateBtn.addEventListener("click", function() {
    switchWindow(['.update-container'], null);
});

const closeUpdateBtnAccs = document.querySelector('.default-section.accounts .update-container .close-btn');
closeUpdateBtnAccs.addEventListener("click", function() {
    switchWindow(['.default-section.accounts .update-container'], null);
});


const openUserModal = document.querySelector('nav .account-side');
openUserModal.addEventListener("click", function(event) {
    event.preventDefault();
    if (event.target.className === 'avatar') {
        switchWindow([], 'nav .account-side .container');
    }
});

const createNewUsrBtn = document.querySelector("#add-new-user");
createNewUsrBtn.addEventListener("click", function() {
  switchWindow([], '.create-new-user-window');
});

const createNewAccBtn = document.querySelector("#add-new-account");
createNewAccBtn.addEventListener("click", function() {
  switchWindow([], '.create-account-win');
});

const closeNewUsrWin = document.querySelector(".create-new-user-window .close-btn");
closeNewUsrWin.addEventListener("click", function() {
  switchWindow(['.default-section.dashboard .create-new-user-window'], null);
});

const closeNewAccWin = document.querySelector(".create-account-win .close-btn");
closeNewAccWin.addEventListener("click", function() {
  switchWindow(['.default-section.accounts .create-account-win'], null);
});

const locationsPaths = document.querySelectorAll('.default-section');
const locationsBtn = document.querySelectorAll('.location-button');

locationsBtn.forEach(location => {
    location.addEventListener("click", function() {
      const path = this.dataset.location;
      locationsPaths.forEach(el => {
        if (el.dataset.path != path) el.classList.remove('isActive');
        else el.classList.add('isActive');
      });
    })
});
