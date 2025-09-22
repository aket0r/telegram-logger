const DATA = fs.readFile
const LOG_CONFIG = {
    path: './src/assets/data/logs.txt',
    logs: ""
}

class Logs {
    constructor() {
        LOG_CONFIG.logs = this.get();
    }

    execute(message) {
        const entry = {
            ts: new Date().toLocaleString(),
            message: message || String(message)
        };

        fs.appendFileSync(LOG_CONFIG.path, JSON.stringify(entry) + "\n", "utf8");
    }

    get() {
        console.time('log');
        const data = fs.readFile(LOG_CONFIG.path, 'utf8', async function (err, data) {
            if (err) throw err;
            LOG_CONFIG.logs = data;
        });

        console.timeEnd('log');
        if (LOG_CONFIG.logs.length > 0) {
            console.log('running!')
            this.load();
        } else {
            console.log(LOG_CONFIG.logs.length, 'err');
            setTimeout(() => {
                this.get();
            }, 200);
        }

        return output;
    }

    load() {
        console.log(`[${new Date().toLocaleString()}] Loading logs...`)
        const parse = LOG_CONFIG.logs
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    console.warn("Ошибка парсинга строки:", line, e);
                    return null;
                }
            })
            .filter(Boolean);

        const output = document.querySelector(".logs-output");

        parse.forEach(d => {
            const div = document.createElement("div");
            div.classList.add("logs-item");
            div.innerHTML =
                `
            <span class="date">[${d.ts}]</span>
            <div>
                <span class="text">${d.message}</span>
                <span class="stack">${d.stack}</span>
            </div>
            `
            output.prepend(div);
        });

        const logLength = document.querySelectorAll('.stats .count')[2];
        logLength.textContent = parse.length;
    }
}

const _LOG = new Logs();
