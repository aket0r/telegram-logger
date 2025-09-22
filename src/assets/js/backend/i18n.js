function loadLocale(code) {
    const full = path.join(__dirname, '..', '/src/assets/locales', `${code}.json`);
    return JSON.parse(fs.readFileSync(full, 'utf8'));
}


const messages = {
    en: loadLocale('en'),
    ru: loadLocale('ru'),
};

if (localStorage.getItem('lang') === null) {
    localStorage.setItem('lang', 'en');
}

let currentLang = localStorage.getItem('lang') == null ? 'en' : localStorage.getItem('lang');

function t(path) {
    return path.split('.').reduce((o, k) => (o || {})[k], messages[currentLang]) || path;
}

function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        const translation = t(key);

        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            el.setAttribute("placeholder", translation);
        } else {
            el.textContent = translation;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    applyTranslations();

    const langSelect = document.getElementById('lang');
    if (langSelect) {
        langSelect.value = currentLang;
        langSelect.addEventListener('change', e => {
            currentLang = e.target.value;
            localStorage.setItem('lang', currentLang);
            applyTranslations();
        });
    }
});
