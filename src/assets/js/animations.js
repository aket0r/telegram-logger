const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => r.querySelectorAll(s);

function hideAllWindows() {
  $$('.window.active').forEach(el => el.classList.remove('active'));
}

function hideSelectors(selectors = []) {
  selectors.forEach(sel => {
    const el = $(sel);
    if (el) el.classList.remove('active');
  });
}

function showSelector(selector) {
  const el = $(selector);
  if (el) el.classList.add('active');
}

function switchWindow({ close = [], open = null, toggle = false } = {}) {
  if (toggle && open) {
    const el = $(open);
    if (el && el.classList.contains('active')) {
      hideSelectors([open]);
      return;
    }
  }

  if (close === '*') hideAllWindows();
  else if (Array.isArray(close) && close.length) hideSelectors(close);

  if (open) showSelector(open);
}

const table = $('.table-content');
if (table) {
  table.addEventListener('click', (e) => {
    const btn = e.target.closest('.show-update');
    if (!btn) return;
    if (btn.tagName === 'A') e.preventDefault();

    switchWindow({
      close: '*',
      open: '.update-container',
      toggle: true,
    });
  });
}

const closeUpdateBtn = $('.update-container .close-btn');
if (closeUpdateBtn) {
  closeUpdateBtn.addEventListener('click', (e) => {
    e.preventDefault();
    switchWindow({ close: ['.update-container'] });
  });
}

const accountSide = $('nav .account-side');
if (accountSide) {
  accountSide.addEventListener('click', (e) => {
    const avatar = e.target.closest('.avatar');
    if (!avatar) return;
    e.preventDefault();

    switchWindow({
      close: '*',
      open: 'nav .account-side .container',
      toggle: true,
    });
  });
}
