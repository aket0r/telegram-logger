let client;
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

const sendLog = function (message) {
    fs.writeFileSync(path.join(__dirname, 'src', 'assets', 'data', 'logs2.txt'), JSON.stringify(message));
}



const LOG_FILE = path.join(__dirname, 'src', 'assets', 'data', 'users.json');
const MEDIA_DIR = path.join(__dirname, 'src', 'assets', 'data', 'media');
console.log(MEDIA_DIR);
const { FloodWaitError } = require('telegram/errors');
const sleep = ms => new Promise(r => setTimeout(r, ms));


function notifyProgress(wc, data) {
    try { wc?.send('dialogs:progress', data); } catch { }
}

function parseFloodSeconds(errMsg, secondsField) {
    if (typeof secondsField === 'number' && Number.isFinite(secondsField)) {
        return secondsField;
    }
    const m = String(errMsg || '').match(/FLOOD_WAIT_(\d+)/i);
    return m ? Number(m[1]) : 0;
}

async function safeInvoke(wc, fn) {
    try {
        return await fn();
    } catch (e) {
        const msg = e?.errorMessage || e?.message || String(e);
        if (e instanceof FloodWaitError || /FLOOD_WAIT_/i.test(msg)) {
            const secs = parseFloodSeconds(msg, e?.seconds);
            notifyProgress(wc, { phase: 'flood', seconds: secs });
            await sleep(secs * 1000);
            return await fn(); // одна повторная попытка
        }
        throw e;
    }
}

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

function upsertConvoHeader(file, { peerId, name, username }) {
    // console.log('[NewMessage]', { peerId: who.peerId, username: who.username, name: displayName });
    const convos = readConversations(file);
    const i = convos.findIndex(c => String(c.peerId) === String(peerId));
    if (i === -1) {
        convos.push({ peerId: String(peerId), name: name || 'Unknown', username: username || null, messages: [], lastTs: null });
    } else {
        const c = convos[i];
        if (name && c.name !== name) c.name = name;
        if (username && c.username !== username) c.username = username;
    }
    saveConversations(file, convos);
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
        if (name && convo.name !== name) convo.name = name;
        if (username && convo.username !== username) convo.username = username;

        const j = convo.messages.findIndex(m => m.id === msg.id);
        if (j === -1) {
            convo.messages.push(msg);
        } else {
            convo.messages[j] = mergeShallow(convo.messages[j], msg);
        }
        if (msg.ts) convo.lastTs = msg.ts;
    }

    saveConversations(file, convos);
    return convos.find(c => String(c.peerId) === String(peerId));
}

const fmtTS_duo = (sec) => new Date(sec * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

async function parseForwardMeta(client, m) {
    const fwd = m.fwdFrom;
    if (!fwd) return null;

    const meta = {
        isForwarded: true,
        date: fwd.date ? new Date(fwd.date * 1000).toISOString() : null,
        from: { type: 'hidden', id: null, username: null, title: fwd.fromName || null },
        original: {
            channelPostId: fwd.channelPost || null,
            savedFromMsgId: fwd.savedFromMsgId || null
        }
    };

    // Явный источник (user/channel)
    const srcId = fwd.fromId || fwd.savedFromPeer;
    if (srcId) {
        try {
            const ent = await client.getEntity(srcId);
            const isChannel = !!ent?.title;
            meta.from = {
                type: isChannel ? 'channel' : 'user',
                id: ent?.id?.toString?.() || null,
                username: ent?.username || null,
                title: isChannel
                    ? ent.title
                    : [ent.firstName, ent.lastName].filter(Boolean).join(' ') || null
            };
        } catch { /* ignore */ }
    }

    return meta;
}


async function fetchMediaFromPeer({ client, peer, filter, limit = 100, autoDownload = true }) {
    const entity = await resolveEntity(client, peer);
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
        id: m.id, // важно: сохраняем id
        ts: new Date(m.date * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' }),
        dir,
        text: m.message || '',
        type: 'text',
    };

    // ✳️ forward-мета всегда
    const fwd = await parseForwardMeta(client, m);
    if (fwd) base.forward = fwd;

    // ✳️ media
    const k = mediaKind(m);
    if (k.kind === 'none') return base;

    const peerFolder = path.join(MEDIA_DIR, String(peerMeta.peerId));
    ensureDir(peerFolder);

    const AUTO_MB = 35 * 1024 * 1024;
    const media = { kind: k.kind, mime: k.mime, size: null, path: null, name: null, duration: null, thumb: null, lazy: false };

    try {
        if (k.kind === 'photo') {
            const filePath = path.join(peerFolder, `photo_${m.id}.jpg`);
            await client.downloadMedia(m.media, { outputFile: filePath });
            media.path = filePath;
            base.type = 'photo';
            base.media = media;
            return base;
        }

        if (k.kind === 'voice' || k.kind === 'video' || k.kind === 'file' || k.kind === 'sticker_or_image') {
            const doc = m.media.document;
            media.name = pickDocName(doc);
            const size = typeof doc?.size === 'number' ? doc.size : null;
            media.size = size;

            const canAuto = size == null || size <= AUTO_MB;
            if (canAuto) {
                const extGuess =
                    k.kind === 'voice' ? '.ogg' :
                        k.kind === 'video' ? '.mp4' :
                            (k.kind === 'sticker_or_image' && (k.mime || '').includes('webp') ? '.webp' : '') || '';
                const outFile = path.join(peerFolder, `${k.kind}_${m.id}${extGuess}`);
                await client.downloadMedia(m.media, { outputFile: outFile });
                media.path = outFile;
            } else {
                media.lazy = true;
            }

            base.type = (k.kind === 'voice') ? 'voice' :
                (k.kind === 'video') ? 'video' :
                    (k.kind === 'sticker_or_image') ? 'sticker' : 'file';
            base.media = media;
            return base;
        }

        base.type = 'unknown';
        base.media = { kind: 'unknown' };
        return base;
    } catch (e) {
        media.lazy = true;
        base.media = media;
        return base;
    }
}
async function collectDMsFromFolder(folderId, need) {
    let localOffsetDate = 0, localOffsetId = 0, localOffsetPeer = new Api.InputPeerEmpty();
    let safety = 0;
    while (collectedDMs.length < need && safety < 2000) {
        const res = await safeInvoke(wc, () => client.invoke(new Api.messages.GetDialogs({
            offsetDate: localOffsetDate,
            offsetId: localOffsetId,
            offsetPeer: localOffsetPeer,
            limit: Math.min(100, need - collectedDMs.length),
            folderId,
            hash: 0,
            excludePinned: false,
        })));
        const dialogsBatch = res?.dialogs || [];
        if (!dialogsBatch.length) break;

        const usersById = new Map((res.users || []).map(u => [u.id.valueOf(), u]));

        for (const d of dialogsBatch) {
            const uId = d.peer?.userId?.valueOf?.();
            if (!uId) continue;                // только PeerUser
            const ent = usersById.get(uId);
            if (!ent) continue;
            if (me && ent.id?.valueOf?.() === me.id?.valueOf?.()) continue; // self
            if (ent.bot) continue;                                         // боты — мимо

            // избегаем дублей
            if (!collectedDMs.some(x => x.id?.valueOf?.() === ent.id?.valueOf?.())) {
                collectedDMs.push(ent);
            }
            if (collectedDMs.length >= need) break;
        }

        // корректная пагинация (как выше)
        const lastDialog = dialogsBatch[dialogsBatch.length - 1];
        const topMsgId = lastDialog?.topMessage?.valueOf?.() || lastDialog?.topMessage || 0;
        const topMsgObj = (res.messages || []).find(m => m.id?.valueOf?.() === topMsgId || m.id === topMsgId);

        localOffsetId = topMsgId || 0;
        localOffsetDate = topMsgObj?.date?.valueOf?.() || (topMsgObj?.date ? Number(topMsgObj.date) : 0);
        const peer = lastDialog?.peer;
        localOffsetPeer =
            peer?.userId ? new Api.InputPeerUser({ userId: peer.userId }) :
                peer?.chatId ? new Api.InputPeerChat({ chatId: peer.chatId }) :
                    peer?.channelId ? new Api.InputPeerChannel({ channelId: peer.channelId }) :
                        new Api.InputPeerEmpty();

        send({ phase: 'collect', found: collectedDMs.length, target: dialogs });
        safety++;
        await sleep(150);
    }
}


function titleOfEntity(ent) {
    const username = ent?.username || null;
    const name = [ent?.firstName, ent?.lastName].filter(Boolean).join(' ')
        || ent?.title || 'Unknown';
    return { username, displayName: username ? '@' + username : name };
}

// === force load last dialogs and messages ===
async function forceLoadMessage({ dialogsLimit = 120, perChatLimit = 50 } = {}) {
    if (!client) throw new Error('client not initialized');

    // свой id (чтобы исключить "Избранное")
    let me = null;
    try { me = await client.getMe(); } catch { }

    const last = dialogsBatch[dialogsBatch.length - 1];

    // topMessage — это ID. Найдём сам объект сообщения, чтобы взять date:
    const topMsgId = last?.topMessage?.valueOf?.() || last?.topMessage || 0;
    const topMsgObj = (res.messages || []).find(
        m => (m.id?.valueOf?.() ?? m.id) === topMsgId
    );

    let collectedDMs = [];         // сюда складываем только PeerUser
    let offsetId = topMsgId || 0;
    let offsetDate = topMsgObj?.date?.valueOf?.() || (topMsgObj?.date ? Number(topMsgObj.date) : 0);
    let offsetPeer = new Api.InputPeerEmpty();
    let safety = 0;

    const peer = last?.peer;
    offsetPeer =
        peer?.userId ? new Api.InputPeerUser({ userId: peer.userId }) :
            peer?.chatId ? new Api.InputPeerChat({ chatId: peer.chatId }) :
                peer?.channelId ? new Api.InputPeerChannel({ channelId: peer.channelId }) :
                    new Api.InputPeerEmpty();

    const seen = new Set(collectedDMs.map(u => String(u.id)));
    if (!seen.has(String(ent.id))) { collectedDMs.push(ent); seen.add(String(ent.id)); }


    while (collectedDMs.length < dialogsLimit && safety < 2000) {
        const res = await client.invoke(new Api.messages.GetDialogs({
            offsetDate,
            offsetId,
            offsetPeer,
            limit: Math.min(100, dialogsLimit - collectedDMs.length), // сервер всё равно вернёт меньше
            hash: 0,
            folderId: 0,          // только основная папка; если нужно — добавим цикл по 1 (архив)
            excludePinned: false,
        }));

        const dialogs = res.dialogs || [];
        if (!dialogs.length) break;

        const usersById = new Map((res.users || []).map(u => [u.id.valueOf(), u]));

        for (const d of dialogs) {
            const p = d.peer;
            const userId = p?.userId?.valueOf?.();
            if (!userId) continue;
            const ent = usersById.get(userId);
            if (!ent) continue;
            if (me && ent.id?.valueOf?.() === me.id?.valueOf?.()) continue;
            if (ent.bot) continue;

            collectedDMs.push({ peerEntity: ent, dialogRaw: d });
            if (collectedDMs.length >= dialogsLimit) break;
        }

        const lastDialog = dialogs[dialogs.length - 1];
        offsetDate = lastDialog?.topMessage?.date?.valueOf?.() || 0;
        offsetId = lastDialog?.topMessage?.id?.valueOf?.() || 0;

        const lastPeer =
            lastDialog?.peer?.userId ? new Api.InputPeerUser({ userId: lastDialog.peer.userId })
                : lastDialog?.peer?.chatId ? new Api.InputPeerChat({ chatId: lastDialog.peer.chatId })
                    : lastDialog?.peer?.channelId ? new Api.InputPeerChannel({ channelId: lastDialog.peer.channelId })
                        : new Api.InputPeerEmpty();

        offsetPeer = lastPeer;

        safety++;
        await sleep(150);
    }

    let processed = 0;
    for (const { peerEntity: ent } of collectedDMs) {
        const peerId = String(ent.id);
        const { username, displayName } = titleOfEntity(ent);
        const usernameToSave = ent.firstName || ent.username || null;

        upsertConvoHeader(LOG_FILE, { peerId, name: username, username: usernameToSave });

        let msgs = [];
        try {
            msgs = await client.getMessages(ent, { limit: perChatLimit, offsetId: 0 });
        } catch {
            continue;
        }

        for (const m of msgs.reverse()) {
            if (!(m instanceof Api.Message)) continue;
            const nm = await normalizeMessage(client, m, { peerId });
            nm.from = m.out ? 'you' : (displayName || 'Unknown');

            upsertMessage(LOG_FILE, {
                peerId,
                name: displayName,
                username: usernameToSave,
                msg: nm
            });
        }

        processed++;
        await sleep(100);
    }

    return { ok: true, dialogsProcessed: processed, dmsFound: collectedDMs.length };
}

async function resolveDMParticipant(m, client) {
    if (!(m.peerId instanceof Api.PeerUser)) return null;
    const entity = m.out ? await client.getEntity(m.peerId) : await m.getSender();
    let username = entity?.username || null;

    if (entity?.firstName != null || entity?.lastName != null) {
        console.log('Resolved user:', entity.id, entity.username, entity.firstName, entity.lastName);
        username = (entity?.firstName || '') + (entity?.lastName ? (' ' + entity?.lastName) : '');
    }

    const name =
        (entity?.username ? '@' + entity?.username : null) ||
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

function mergeShallow(a, b) {
    const out = { ...a, ...b };
    if (a.media || b.media) out.media = { ...(a.media || {}), ...(b.media || {}) };
    if (a.forward || b.forward) out.forward = { ...(a.forward || {}), ...(b.forward || {}) };
    return out;
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


// вверх файла рядом с другими утилитами:
function cleanUsername(input) {
    if (!input) return null;
    let s = String(input).trim();

    // t.me/username, https://t.me/username, tg://resolve?domain=username
    const m1 = s.match(/t\.me\/(@?[\w\d_]+)/i);
    const m2 = s.match(/domain=([\w\d_]+)/i);
    if (m1) s = m1[1];
    if (m2) s = m2[1];

    // убираем @
    if (s.startsWith('@')) s = s.slice(1);

    // username должен быть a-z0-9_
    if (!/^[\w\d_]{5,32}$/i.test(s)) return null;
    return s;
}

async function resolveEntity(client, raw) {
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) {
        return client.getEntity(Number(raw));
    }
    const uname = cleanUsername(raw);
    if (uname) {
        try {
            const res = await client.invoke(new Api.contacts.ResolveUsername({ username: uname }));
            const ent = (res.users && res.users[0]) || (res.chats && res.chats[0]);
            if (ent) return ent;
        } catch { }
        return client.getEntity('@' + uname);
    }
    return client.getEntity(raw);
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

    client = new TelegramClient(loadSession(), API_ID, API_HASH, {
        connectionRetries: 5,
        deviceModel: 'Telegram Logger',
        systemVersion: 'Node.js',
        appVersion: '1.0.0',
        floodSleepThreshold: 0
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
            const entity = await resolveEntity(client, peer);
            const peerId = entity.id?.toString?.() || String(peer);

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
            const name = entity.firstName || entity.title || null;
            console.log('[UPSERT]', { peerId, username_in: username });
            const displayName = username ? '@' + username
                : [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';
            // Нормализуем СТАРЫЕ→НОВЫЕ (удобно для отрисовки)
            const normalized = [];
            for (const m of out.reverse()) {
                const nm = await normalizeMessage(client, m, { peerId });
                normalized.push(nm);

                nm.from = m.out ? "you" : (displayName || "Unknown");

                upsertMessage(LOG_FILE, {
                    peerId,
                    name: name,
                    username: displayName,
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


    ipcMain.handle('avatar:fetch', async (_e, { peer }) => {
        try {
            if (!client) throw new Error('client not initialized');

            const entity = await resolveEntity(client, peer);
            const peerId = entity.id?.toString?.() || String(peer);

            const username = entity.firstName || null;
            const displayName = username ? '@' + username
                : [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';

            // Обновим header у диалога, даже если сообщений ещё не тянули
            upsertConvoHeader(LOG_FILE, { peerId, name: displayName, username });


            const folder = path.join(MEDIA_DIR, peerId);
            ensureDir(folder);
            const outPath = path.join(folder, `avatar_${peerId}.jpg`);

            // кэш
            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
                return { ok: true, path: outPath, peerId };
            }

            try {
                const res = await client.invoke(new Api.photos.GetUserPhotos({
                    userId: entity, offset: 0, maxId: 0, limit: 1
                }));
                const photo = (res?.photos || [])[0];
                if (photo) {
                    await client.downloadMedia(photo, { outputFile: outPath });
                    return { ok: true, path: outPath, peerId };
                }
            } catch (_) { /* может быть не user */ }

            if (entity.photo) {
                try {
                    await client.downloadMedia(entity.photo, { outputFile: outPath });
                    return { ok: true, path: outPath, peerId };
                } catch (_) { /* ignore */ }
            }

            return { ok: false, error: 'no avatar', peerId };
        } catch (e) {
            console.error('avatar:fetch error:', e);
            return { ok: false, error: String(e?.message || e) };
        }
    });

    ipcMain.handle('dialogs:forceLoad', async (e, { dialogs = 1000, perChat = 1000, opId }) => {
        if (!client) return { ok: false, error: 'client not initialized', opId };

        const wc = e.sender;
        const send = (data) => { try { wc.send('dialogs:progress', { opId, ...data }); } catch { } };
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // ===== 1) Сбор только личных диалогов (PeerUser), без ботов и self) =====
        const collectedDMs = [];
        const seen = new Set();
        let offsetDate = 0, offsetId = 0, offsetPeer = new Api.InputPeerEmpty();
        let safety = 0;

        let me = null;
        try { me = await client.getMe(); } catch { }

        while (collectedDMs.length < dialogs && safety < 2000) {
            const res = await safeInvoke(wc, () =>
                client.invoke(new Api.messages.GetDialogs({
                    offsetDate, offsetId, offsetPeer,
                    limit: Math.min(100, dialogs - collectedDMs.length),
                    folderId: 0, // основная папка
                    hash: 0, excludePinned: false,
                }))
            );

            const dialogsBatch = res?.dialogs || [];
            if (!dialogsBatch.length) break;

            const usersById = new Map((res.users || []).map(u => [u.id.valueOf(), u]));

            for (const d of dialogsBatch) {
                const userId = d?.peer?.userId?.valueOf?.();
                if (!userId) continue; // не PeerUser → пропускаем

                const ent = usersById.get(userId);
                if (!ent) continue;

                if (me && ent.id?.valueOf?.() === me.id?.valueOf?.()) continue; // исключить "Избранное"
                if (ent.bot) continue;                                           // исключить ботов

                const key = String(ent.id?.valueOf?.() ?? ent.id);
                if (seen.has(key)) continue;
                seen.add(key);

                collectedDMs.push(ent);
                if (collectedDMs.length >= dialogs) break;
            }

            // --- корректная пагинация: topMessage — это ID; дату берём из res.messages ---
            const last = dialogsBatch[dialogsBatch.length - 1];
            const topMsgId = last?.topMessage?.valueOf?.() || last?.topMessage || 0;
            const topMsgObj = (res.messages || []).find(m =>
                (m?.id?.valueOf?.() ?? m?.id) === topMsgId
            );

            offsetId = topMsgId || 0;
            offsetDate = topMsgObj?.date?.valueOf?.() || (topMsgObj?.date ? Number(topMsgObj.date) : 0);

            const peer = last?.peer;
            offsetPeer =
                peer?.userId ? new Api.InputPeerUser({ userId: peer.userId }) :
                    peer?.chatId ? new Api.InputPeerChat({ chatId: peer.chatId }) :
                        peer?.channelId ? new Api.InputPeerChannel({ channelId: peer.channelId }) :
                            new Api.InputPeerEmpty();

            send({ phase: 'collect', found: collectedDMs.length, target: dialogs });
            safety++;
            await sleep(150);
        }

        // (опционально) добор из Архива, если личек меньше нужного
        if (collectedDMs.length < dialogs) {
            offsetDate = 0; offsetId = 0; offsetPeer = new Api.InputPeerEmpty();
            safety = 0;
            while (collectedDMs.length < dialogs && safety < 2000) {
                const res = await safeInvoke(wc, () =>
                    client.invoke(new Api.messages.GetDialogs({
                        offsetDate, offsetId, offsetPeer,
                        limit: Math.min(100, dialogs - collectedDMs.length),
                        folderId: 1, // архив
                        hash: 0, excludePinned: false,
                    }))
                );

                const dialogsBatch = res?.dialogs || [];
                if (!dialogsBatch.length) break;

                const usersById = new Map((res.users || []).map(u => [u.id.valueOf(), u]));

                for (const d of dialogsBatch) {
                    const userId = d?.peer?.userId?.valueOf?.();
                    if (!userId) continue;

                    const ent = usersById.get(userId);
                    if (!ent) continue;

                    if (me && ent.id?.valueOf?.() === me.id?.valueOf?.()) continue;
                    if (ent.bot) continue;

                    const key = String(ent.id?.valueOf?.() ?? ent.id);
                    if (seen.has(key)) continue;
                    seen.add(key);

                    collectedDMs.push(ent);
                    if (collectedDMs.length >= dialogs) break;
                }

                const last = dialogsBatch[dialogsBatch.length - 1];
                const topMsgId = last?.topMessage?.valueOf?.() || last?.topMessage || 0;
                const topMsgObj = (res.messages || []).find(m =>
                    (m?.id?.valueOf?.() ?? m?.id) === topMsgId
                );

                offsetId = topMsgId || 0;
                offsetDate = topMsgObj?.date?.valueOf?.() || (topMsgObj?.date ? Number(topMsgObj.date) : 0);

                const peer = last?.peer;
                offsetPeer =
                    peer?.userId ? new Api.InputPeerUser({ userId: peer.userId }) :
                        peer?.chatId ? new Api.InputPeerChat({ chatId: peer.chatId }) :
                            peer?.channelId ? new Api.InputPeerChannel({ channelId: peer.channelId }) :
                                new Api.InputPeerEmpty();

                send({ phase: 'collect', found: collectedDMs.length, target: dialogs });
                safety++;
                await sleep(150);
            }
        }

        // ===== 2) История по диалогам с пагинацией сообщений =====
        let processed = 0;

        for (const ent of collectedDMs) {
            const peerId = String(ent.id);
            const username = ent.username || null;
            const name = (ent.firstName !== null) ? ent.firstName : ent.username + ' ' + (ent.lastName !== null) ? ent.lastName : '' || null;
            const displayName = username
                ? '@' + username
                : [ent.firstName, ent.lastName].filter(Boolean).join(' ') || 'Unknown';

            // обновим «шапку» диалога (name/username)
            upsertConvoHeader(LOG_FILE, { peerId, name: name || displayName, username });

            // пагинация сообщений: собираем до perChat штук
            const collectedMsgs = [];
            let offId = 0;
            while (collectedMsgs.length < perChat) {
                const batch = await safeInvoke(wc, () =>
                    client.getMessages(ent, {
                        limit: Math.min(100, perChat - collectedMsgs.length),
                        offsetId: offId
                    })
                );
                if (!batch || batch.length === 0) break;
                collectedMsgs.push(...batch);
                offId = batch[batch.length - 1].id;
                if (batch.length < 100) break;
                await sleep(80);
            }

            // пишем СТАРЫЕ → НОВЫЕ
            for (const m of collectedMsgs.reverse()) {
                if (!(m instanceof Api.Message)) continue;
                const nm = await normalizeMessage(client, m, { peerId });
                nm.from = m.out ? 'you' : (displayName || 'Unknown');

                upsertMessage(LOG_FILE, {
                    peerId,
                    name: name,
                    username: displayName,
                    msg: nm
                });
            }

            processed++;
            send({ phase: 'load', done: processed, total: collectedDMs.length });
            await sleep(100);
        }

        send({ phase: 'done', done: processed, total: collectedDMs.length });
        return { ok: true, dialogsProcessed: processed, total: collectedDMs.length, opId };
    });

    ipcMain.handle('self:avatar:fetch', async () => {
        try {
            if (!client) return { ok: false, error: 'client not initialized' };

            const me = await client.getMe(); // Api.User
            const peerId = String(me.id);
            const username = me.username || null;            // <- ваш @username (без @)
            const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || null;

            const folder = path.join(MEDIA_DIR, 'me');
            ensureDir(folder);
            const outPath = path.join(folder, 'avatar_me.jpg');

            // кэш
            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
                return { ok: true, path: outPath, peerId, username, name };
            }

            // загрузка
            const res = await client.invoke(new Api.photos.GetUserPhotos({
                userId: me, offset: 0, maxId: 0, limit: 1
            }));
            const photo = (res?.photos || [])[0];
            if (!photo) return { ok: true, path: null, peerId, username, name }; // аватара нет, но username вернули

            await client.downloadMedia(photo, { outputFile: outPath });

            const exists = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
            return { ok: exists, path: exists ? outPath : null, peerId, username, name };
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

        console.log(`[NewMessage] ${nm.dir === 'out' ? '->' : '<-'} ${who.peerId} ${displayName}:`, safeStr(nm.text), nm.media ? `(media: ${nm.media.kind})` : '');
        // пишем В ТОЙ ЖЕ ФОРМЕ, что и история (без «самодельного rec»)
        upsertMessage(LOG_FILE, {
            peerId: who.peerId,
            name: displayName,
            username: who.firstName || who.username || null,
            msg: nm,
        });
        // console.log('New message from', displayName, nm, who);
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
