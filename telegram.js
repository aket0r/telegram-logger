const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Api } = require('telegram');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const API_ID = parseInt(process.env.API_ID || '', 10);
const API_HASH = process.env.API_HASH || '';
const PHONE = process.env.PHONE || '';
const SESSION_FILE = process.env.SESSION_FILE || '.tg_session';

const LOG_FILE = path.join(__dirname, 'src', 'assets', 'data', 'logs.json');
const MEDIA_DIR = path.join(__dirname, 'src', 'assets', 'data', 'media');

ipcMain.handle('media:download', async (_e, { peerId, messageId }) => {
    try {
        const entity = await client.getEntity(Number(peerId));
        const msgs = await client.getMessages(entity, { ids: [Number(messageId)] });
        const m = msgs[0];
        if (!m || !m.media) return { ok: false, error: 'no media' };

        const folder = path.join(MEDIA_DIR, String(entity.id));
        ensureDir(folder);

        let outPath = null;
        if (m.media instanceof Api.MessageMediaPhoto) {
            outPath = path.join(folder, `photo_${m.id}.jpg`);
        } else if (m.media instanceof Api.MessageMediaDocument) {
            const doc = m.media.document;
            const isVoice = doc?.attributes?.some(a => a instanceof Api.DocumentAttributeAudio && a.voice);
            const isRound = doc?.attributes?.some(a => a instanceof Api.DocumentAttributeVideo && a.roundMessage);
            const ext =
                isVoice ? '.ogg' :
                    isRound ? '.mp4' :
                        (doc?.mimeType?.includes('webm') ? '.webm' :
                            doc?.mimeType?.includes('mp4') ? '.mp4' : '');
            const base = isVoice ? 'voice' : (isRound ? 'round' : 'doc');
            outPath = path.join(folder, `${base}_${m.id}${ext}`);
        }
        if (!outPath) return { ok: false, error: 'unsupported media' };

        await client.downloadMedia(m.media, { outputFile: outPath });

        // обновим запись в logs.json (добавим media.path к уже существующему сообщению)
        const convos = readConversations(LOG_FILE);
        const c = convos.find(x => String(x.peerId) === String(peerId));
        if (c) {
            const msg = c.messages.find(x => x.id === m.id);
            if (msg) {
                msg.type = msg.type || 'voice';
                msg.media = Object.assign({}, msg.media, { path: outPath });
                saveConversations(LOG_FILE, convos);
            }
        }

        return { ok: true, path: outPath };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
});



function readConversations(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) return [];
        const json = JSON.parse(raw);
        return Array.isArray(json) ? json : [];
    } catch { return []; }
}

function saveConversations(file, arr) {
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}

function upsertMessage(file, { peerId, name, username, msg }) {
    const convos = readConversations(file);
    const i = convos.findIndex(c => String(c.peerId) === String(peerId));
    if (i === -1) {
        convos.push({
            peerId: String(peerId),
            name: name || 'Unknown',
            username: username || null,
            messages: [msg],
            lastTs: msg.ts
        });
    } else {
        const convo = convos[i];
        // простая защита от дублей (по id, если есть; иначе по ts+dir+text)
        const last = convo.messages[convo.messages.length - 1];
        const same = (a, b) => (a.id && b.id && a.id === b.id) || (a.ts === b.ts && a.dir === b.dir && a.text === b.text);
        if (!last || !same(last, msg)) {
            convo.messages.push(msg);
            convo.lastTs = msg.ts;
        }
        if (!convo.username && username) convo.username = username;
        if (name && convo.name !== name) convo.name = name;
    }
    saveConversations(file, convos);
    return convos.find(c => String(c.peerId) === String(peerId));
}

const fmtTS_duo = (sec) => new Date(sec * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

async function normalizeMessage(client, m, { peerId }) {
    const base = {
        id: m.id,
        ts: fmtTS_duo(m.date),
        dir: m.out ? 'out' : 'in',
        text: m.message || (m.media ? '[media]' : ''),
        type: m.message ? 'text' : (m.media ? 'media' : 'text'),
    };
    // при желании можешь здесь определить виды медиа (voice/photo/video/file) как раньше
    return base;
}

async function fetchMediaFromPeer({ client, peer, filter, limit = 100, autoDownload = true }) {
    const entity = await client.getEntity(peer);
    let collected = [];
    let offsetId = 0;

    while (collected.length < limit) {
        const batch = await client.invoke(new Api.messages.Search({
            peer: entity,
            q: '',
            filter,
            minDate: 0,
            maxDate: 0,
            offsetRate: 0,
            offsetPeer: new Api.InputPeerEmpty(),
            offsetId,
            limit: Math.min(100, limit - collected.length),
            maxId: 0,
            minId: 0,
            hash: 0
        }));

        const msgs = (batch?.messages || []).filter(x => x instanceof Api.Message);
        if (!msgs.length) break;

        collected.push(...msgs);
        offsetId = msgs[msgs.length - 1].id;
    }

    if (autoDownload) {
        const folder = path.join(MEDIA_DIR, String(entity.id));
        ensureDir(folder);

        for (const m of collected) {
            try {
                let outPath = null;

                if (m.media instanceof Api.MessageMediaPhoto) {
                    outPath = path.join(folder, `photo_${m.id}.jpg`);
                    await client.downloadMedia(m.media, { outputFile: outPath });
                } else if (m.media instanceof Api.MessageMediaDocument) {
                    const doc = m.media.document;

                    const isVoiceNote = doc.attributes?.some(a => a instanceof Api.DocumentAttributeAudio && a.voice);
                    const isRound = doc.attributes?.some(a => a instanceof Api.DocumentAttributeVideo && a.roundMessage);

                    const ext =
                        isVoiceNote ? '.ogg' :
                            (isRound ? '.mp4' :
                                (doc.mimeType?.includes('webm') ? '.webm' :
                                    doc.mimeType?.includes('mp4') ? '.mp4' : ''));
                    outPath = path.join(folder, `${isVoiceNote ? 'voice' : (isRound ? 'round' : 'doc')}_${m.id}${ext}`);
                    await client.downloadMedia(m.media, { outputFile: outPath });
                }

                if (outPath) {
                    console.log('saved:', outPath);
                }
            } catch (e) {
                console.warn('download failed:', e?.message || e);
            }
        }
    }

    return collected;
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function isVoiceDocument(doc) {
    if (!doc || !doc.attributes) return false;
    return doc.attributes.some(a => a instanceof Api.DocumentAttributeAudio && a.voice);
}

function pickDocName(doc) {
    const attr = (doc?.attributes || []).find(a => a instanceof Api.DocumentAttributeFilename);
    return attr?.fileName || `${doc?.id || Date.now()}.bin`;
}

function mediaKind(m) {
    if (!m?.media) return { kind: 'none' };
    if (m.media instanceof Api.MessageMediaPhoto) return { kind: 'photo' };
    if (m.media instanceof Api.MessageMediaDocument) {
        const doc = m.media.document;
        if (isVoiceDocument(doc)) return { kind: 'voice', mime: doc.mimeType };
        if ((doc?.mimeType || '').startsWith('image/')) return { kind: 'sticker_or_image', mime: doc.mimeType };
        if ((doc?.mimeType || '').startsWith('video/')) return { kind: 'video', mime: doc.mimeType };
        return { kind: 'file', mime: doc?.mimeType };
    }
    return { kind: 'unknown' };
}

async function normalizeMessage(client, m, peerMeta) {
    const dir = m.out ? 'out' : 'in';
    const base = {
        ts: new Date(m.date * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }),
        dir,
        text: m.message || '',
        type: 'text',
    };

    const k = mediaKind(m);
    if (k.kind === 'none') return base;

    const peerFolder = path.join(MEDIA_DIR, String(peerMeta.peerId));
    ensureDir(peerFolder);

    const AUTO_MB = 35; // MB Limit

    const media = { kind: k.kind, mime: k.mime, size: null, path: null, name: null, duration: null, thumb: null, lazy: false };

    try {
        if (k.kind === 'photo') {
            const filePath = path.join(peerFolder, `photo_${m.id}.jpg`);
            await client.downloadMedia(m.media, { outputFile: filePath });
            media.path = filePath; base.type = 'photo'; base.media = media; return base;
        }

        if (k.kind === 'voice' || k.kind === 'video' || k.kind === 'file' || k.kind === 'sticker_or_image') {
            const doc = m.media.document;
            media.name = pickDocName(doc);

            const szAttr = doc?.size || doc?.sizes;
            if (typeof szAttr === 'number') media.size = szAttr;

            const canAuto = media.size == null || media.size <= AUTO_MB * 1024 * 1024;

            if (canAuto) {
                const extGuess =
                    k.kind === 'voice' ? '.ogg' :
                        (k.kind === 'video' ? '.mp4' :
                            (k.kind === 'sticker_or_image' && (k.mime || '').includes('webp') ? '.webp' : '')) || '';

                const outFile = path.join(peerFolder, `${k.kind}_${m.id}${extGuess}`);
                await client.downloadMedia(m.media, { outputFile: outFile });
                media.path = outFile;
            } else {
                media.lazy = true;
            }

            if (k.kind === 'voice') base.type = 'voice';
            else if (k.kind === 'video') base.type = 'video';
            else if (k.kind === 'sticker_or_image') base.type = 'sticker';
            else base.type = 'file';

            base.media = media;
            return base;
        }

        base.type = 'unknown';
        base.media = { kind: 'unknown' };
        return base;
    } catch (e) {
        base.type = base.type === 'text' ? 'file' : base.type;
        media.lazy = true;
        base.media = media;
        return base;
    }
}



function readConversations(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) return [];
        const json = JSON.parse(raw);
        return Array.isArray(json) ? json : [];
    } catch {
        return [];
    }
}

async function resolveDMParticipant(m, client) {
    if (!(m.peerId instanceof Api.PeerUser)) return null;
    const entity = m.out ? await client.getEntity(m.peerId) : await m.getSender();

    const username = entity?.username || null;
    const name =
        (username ? '@' + username : null) ||
        [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') ||
        'Unknown';
    const peerId =
        (entity?.id && entity.id.toString()) ||
        (m.peerId?.userId && m.peerId.userId.toString()) || null;

    return { peerId, username, name };
}

function saveConversations(file, arr) {
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}

function upsertMessage(file, { peerId, name, username, msg }) {
    const convos = readConversations(file);
    const idx = convos.findIndex(c => c.peerId === peerId);

    const isDup = (a, b) => a.ts === b.ts && a.dir === b.dir && a.text === b.text;

    if (idx === -1) {
        const convo = {
            peerId,
            name,
            username: username || null,
            messages: [msg],
            lastTs: msg.ts
        };
        convos.push(convo);
    } else {
        const convo = convos[idx];
        const last = convo.messages[convo.messages.length - 1];
        if (!last || !isDup(last, msg)) {
            convo.messages.push(msg);
            convo.lastTs = msg.ts;
        }
        if (!convo.username && username) convo.username = username;
        if (convo.name !== name && name) convo.name = name;
    }

    saveConversations(file, convos);
    return convos;
}

const fmtTS = (unixSec) =>
    new Date(unixSec * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

const safeText = (s) => (s ? String(s).replace(/\r?\n/g, ' ') : '');

function readJsonArray(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function appendToJsonArray(file, item) {
    const arr = readJsonArray(file);
    arr.push(item);
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}


function writeLogLine(obj) {
    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + "\n", "utf8");
    } catch (e) {
        console.error("writeLogLine error:", e);
    }
}

function safeStr(s, fallback = "") {
    if (!s) return fallback;
    return String(s).replace(/\r?\n/g, " ").slice(0, 5000);
}

async function resolveChatLabel(message) {
    try {
        const chat = await message.getChat();
        const sender = await message.getSender();

        if (chat?.title) return chat.title;
        if (sender?.username) return "@" + sender.username;
        if (sender?.firstName || sender?.lastName) return [sender.firstName, sender.lastName].filter(Boolean).join(" ");
    } catch { /* ignore */ }
    return "Unknown";
}

function peerIdOf(m) {
    return (
        m.chatId?.valueOf?.() ||
        m.peerId?.channelId?.valueOf?.() ||
        m.peerId?.chatId?.valueOf?.() ||
        m.peerId?.userId?.valueOf?.() ||
        null
    );
}




function loadSession() {
    try { return new StringSession(fs.readFileSync(path.join(__dirname, SESSION_FILE), 'utf8')); }
    catch { return new StringSession(''); }
}
function saveSession(client) {
    fs.writeFileSync(path.join(__dirname, SESSION_FILE), client.session.save(), 'utf8');
}

function waitOnce(channel) {
    return new Promise(resolve => {
        const handler = (_e, payload) => {
            ipcMain.removeListener(channel, handler);
            resolve(payload);
        };
        ipcMain.on(channel, handler);
    });
}

async function startTelegram(mainWindow) {
    if (!API_ID || !API_HASH) {
        console.error('❌ API_ID/API_HASH не заданы в .env');
        mainWindow?.webContents.send('auth:error', { message: 'API_ID/API_HASH не заданы' });
        return;
    }

    const client = new TelegramClient(loadSession(), API_ID, API_HASH, {
        connectionRetries: 5,
        deviceModel: 'Telegram Logger',
        systemVersion: 'Node.js',
        appVersion: '1.0.0',
    });

    try {
        if (!(await client.checkAuthorization())) {
            mainWindow.webContents.send('auth:stage', { stage: 'phone', preset: PHONE });

            await client.start({
                phoneNumber: async () => {
                    if (PHONE) return PHONE;
                    const { value } = await waitOnce('auth:phone');
                    return value;
                },
                phoneCode: async () => {
                    mainWindow.webContents.send('auth:stage', { stage: 'code' });
                    const { value } = await waitOnce('auth:code');
                    return value;
                },
                password: async () => {
                    mainWindow.webContents.send('auth:stage', { stage: 'password' });
                    const { value } = await waitOnce('auth:password');
                    return value;
                },
                onError: (err) => {
                    mainWindow.webContents.send('auth:error', { message: String(err?.message || err) });
                }
            });

            saveSession(client);
            mainWindow.webContents.send('auth:done');
        } else {
            await client.connect();
            mainWindow.webContents.send('auth:done');
        }
    } catch (err) {
        mainWindow.webContents.send('auth:error', { message: String(err?.message || err) });
        return;
    }

    // внутри telegram.js, после инициализации client (в startTelegram), НО ВНЕ addEventHandler:
    ipcMain.handle('chat:fetchHistory', async (_e, { peer, limit = 200 }) => {
        try {
            if (!client) throw new Error('client not initialized');
            // peer: '@username' | numeric id | string id
            const entity = await client.getEntity(peer);
            const peerId = entity.id?.toString?.() || String(peer);

            // Получаем историю порциями (от новых к старым)
            const out = [];
            let offsetId = 0;
            while (out.length < limit) {
                const batch = await client.getMessages(entity, { limit: Math.min(100, limit - out.length), offsetId });
                if (!batch || !batch.length) break;
                out.push(...batch);
                offsetId = batch[batch.length - 1].id;
                if (batch.length < 100) break;
            }

            // Определим отображаемое имя
            const username = entity.username || null;
            const displayName = username ? '@' + username
                : [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';

            // Нормализуем СТАРЫЕ→НОВЫЕ (удобно для отрисовки)
            const normalized = [];
            for (const m of out.reverse()) {
                const nm = await normalizeMessage(client, m, { peerId });
                normalized.push(nm);
                // Пишем по ходу (upsert в logs.json)
                upsertMessage(LOG_FILE, {
                    peerId,
                    name: displayName,
                    username,
                    msg: nm
                });
            }

            // Вернём итоговый разговор из файла (с учётом уже существующих сообщений)
            const convos = readConversations(LOG_FILE);
            const convo = convos.find(c => String(c.peerId) === String(peerId));
            return { ok: true, convo };
        } catch (e) {
            return { ok: false, error: String(e?.message || e) };
        }
    });


    client.addEventHandler(async (event) => {
        const m = event.message;
        if (!m) return;
        if (!(m.peerId instanceof Api.PeerUser)) return;

        const who = await resolveDMParticipant(m, client);
        if (!who) return;

        // 👇 тут получаем готовый объект с type/media/path/id/ts/dir/text
        const nm = await normalizeMessage(client, m, { peerId: who.peerId });
        const displayName = who.name || who.username || "<no name>";

        // пишем В ТОЙ ЖЕ ФОРМЕ, что и история (без «самодельного rec»)
        upsertMessage(LOG_FILE, {
            peerId: who.peerId,
            name: displayName,
            username: who.username,
            msg: nm,
        });

        // в UI тоже отправляем nm
        mainWindow?.webContents.send('tg:new-log', {
            peerId: who.peerId,
            name: displayName,
            username: who.username,
            msg: nm,
        });
    }, new NewMessage({}));






}

module.exports = { startTelegram };
