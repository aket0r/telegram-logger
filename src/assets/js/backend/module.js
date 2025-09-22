const fs = require("fs");
const os = require("os");
const path = require("path");
const Vue = require('vue');
const VueI18n = require('vue-i18n');


const config = {
    path: {
        default: path.join(__dirname, 'assets/data')
    },
    runtime: {
        date: new Date().toLocaleString()
    }
}


class LoadData {
    constructor() { }

    loadDBfromFile(base = null, path = null) {
        if (!base || !path) {
            console.warn('base:', base, 'path:', path);
            return;
        }

        const data = JSON.parse(fs.readFileSync(`${path}\\${base}`));
        return data;
    }

    updateDB(base, path, arr) {
        if (!base || !path || !arr) {
            console.warn('base:', base, 'path:', path, 'arr:', arr);
            return;
        }

        fs.writeFileSync(`${path}\\${base}`, JSON.stringify(arr));
        console.log('success!');
        showNotification({
            title: "Database",
            context: "Database successfuly updated",
            actions: [
                {
                    title: 'Show logs',
                    fn: () => {
                        switchWindow(['.dashboard', '.accounts', '.settings', '.terminal', '.backup', '.file-manager', '.chat'], '.logs', 'isActive')
                    }
                }
            ]
        })
    }
}

const data = new LoadData();

const dataBase = {
    accounts: Object.freeze(data.loadDBfromFile('accounts.json', config.path.default)),
    users: Object.freeze(data.loadDBfromFile('users.json', config.path.default)),
}
