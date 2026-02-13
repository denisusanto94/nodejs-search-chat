
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
const { WebSocketServer } = require('ws');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const AES_SECRET = process.env.AES_SECRET || 'change-me-in-production';

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || '27017';
const MONGO_DB = process.env.MONGO_DB || 'search-chat';
const MONGO_URL = `mongodb://${MONGO_HOST}:${MONGO_PORT}`;

const aesKey = crypto.createHash('sha256').update(AES_SECRET, 'utf8').digest();
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let mongoClient;
let mongoDb;

const getDb = async () => {
    if (mongoDb) {
        return mongoDb;
    }

    mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGO_DB);

    await mongoDb.collection('users').createIndex({ username: 1 }, { unique: true });
    await mongoDb.collection('rooms').createIndex({ type: 1, 'members.userId': 1 });
    await mongoDb.collection('messages').createIndex({ roomId: 1, createdAt: 1 });

    return mongoDb;
};

const getPublicRoom = async () => {
    const db = await getDb();
    const rooms = db.collection('rooms');
    let room = await rooms.findOne({ type: 'public' });
    if (!room) {
        const payload = {
            type: 'public',
            name: 'Public Room',
            members: [],
            createdAt: new Date().toISOString()
        };
        const result = await rooms.insertOne(payload);
        room = { ...payload, _id: result.insertedId };
    }
    return room;
};

const encryptContent = (plaintext) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
    };
};

const decryptContent = (payload) => {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const data = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
};

const encryptPayload = (payload) => encryptContent(JSON.stringify(payload));

const decryptPayload = (payload) => {
    const text = decryptContent(payload);
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        // Fall through to raw content.
    }
    return { content: text };
};

const isOwnMessage = (message, user) => {
    if (message.senderId) {
        return message.senderId === user.userId;
    }
    const username = user.displayName || user.username;
    return message.username === username;
};

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            "img-src": ["'self'", "data:", "blob:", "https:"],
            "connect-src": ["'self'", "https://satudata.jakarta.go.id", "https://cdn.jsdelivr.net"],
            "font-src": ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"]
        }
    }
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public', {
    index: false,
    extensions: ['html', 'htm']
}));
app.use('/uploads', express.static('uploads'));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    skip: (req) => (
        req.path.startsWith('/rooms/public') ||
        req.path.startsWith('/auth/') ||
        req.path === '/users/me' ||
        req.path.startsWith('/rooms/private') ||
        req.path.startsWith('/captcha')
    )
});
app.use('/api/', apiLimiter);

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return next();
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) {
            req.user = user;
        }
        next();
    });
};

const validateBody = (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
    }
    next();
};

const normalizeUsername = (value) => value.trim().toLowerCase();

const captchaStore = new Map();
const CAPTCHA_TTL_MS = 5 * 60 * 1000;

const generateCaptcha = () => {
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const id = crypto.randomBytes(8).toString('hex');
    captchaStore.set(id, { code, expiresAt: Date.now() + CAPTCHA_TTL_MS });
    return { id, code };
};

const validateCaptcha = (id, code) => {
    if (!id || !code) {
        return false;
    }
    const entry = captchaStore.get(id);
    if (!entry) {
        return false;
    }
    if (Date.now() > entry.expiresAt) {
        captchaStore.delete(id);
        return false;
    }
    const match = entry.code === code;
    captchaStore.delete(id);
    return match;
};

// Routes
app.get('/', (req, res) => {
    res.sendFile('search.html', { root: './public' });
});

app.get('/search', (req, res) => {
    res.sendFile('search.html', { root: './public' });
});

app.get('/chat', (req, res) => {
    res.sendFile('chat.html', { root: './public' });
});

app.get('/api/kbbi', async (req, res) => {
    const query = (req.query.q || '').toString().trim();
    if (!query) {
        return res.status(400).json({ error: 'Query required' });
    }

    try {
        const kbbiPath = path.join(__dirname, 'public', 'misc', 'kbbi.txt');
        const content = fs.readFileSync(kbbiPath, 'utf8');
        const words = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const suggestions = words.filter((word) => word.startsWith(query.toLowerCase())).slice(0, 5);
        return res.json({ query, suggestions });
    } catch (error) {
        return res.status(502).json({ error: 'Failed to fetch suggestions' });
    }
});

app.get('/api/captcha', (req, res) => {
    const captcha = generateCaptcha();
    return res.json(captcha);
});

const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = crypto.randomBytes(12).toString('hex');
        cb(null, `${base}${ext}`);
    }
});

const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File required' });
    }

    return res.json({
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
    });
});

app.post('/api/auth/register', validateBody, async (req, res) => {
    try {
        const username = (req.body.username || '').toString().trim();
        const password = (req.body.password || '').toString();
        if (username.length < 3) {
            return res.status(400).json({ error: 'Username minimal 3 karakter' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter' });
        }

        const db = await getDb();
        const users = db.collection('users');
        const existing = await users.findOne({ username: normalizeUsername(username) });
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = {
            username: normalizeUsername(username),
            displayName: username,
            passwordHash,
            createdAt: new Date().toISOString()
        };

        const result = await users.insertOne(user);
        return res.status(201).json({
            id: result.insertedId.toString(),
            username: user.username,
            displayName: user.displayName
        });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', validateBody, async (req, res) => {
    try {
        const username = (req.body.username || '').toString().trim();
        const password = (req.body.password || '').toString();
        const db = await getDb();
        const users = db.collection('users');
        const user = await users.findOne({ username: normalizeUsername(username) });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user._id.toString(), username: user.username, displayName: user.displayName },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            token,
            user: { id: user._id.toString(), username: user.username, displayName: user.displayName }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/users/me', authenticateToken, (req, res) => {
    return res.json({
        id: req.user.userId,
        username: req.user.username,
        displayName: req.user.displayName
    });
});

app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const users = await db
            .collection('users')
            .find({ _id: { $ne: new ObjectId(req.user.userId) } })
            .project({ username: 1, displayName: 1 })
            .toArray();
        return res.json(users.map((user) => ({
            id: user._id.toString(),
            username: user.username,
            displayName: user.displayName
        })));
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/rooms/public', async (req, res) => {
    const room = await getPublicRoom();
    return res.json({ id: room._id.toString(), name: room.name });
});

app.get('/api/rooms/public/messages', optionalAuth, async (req, res) => {
    try {
        const room = await getPublicRoom();
        const db = await getDb();
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
        const after = req.query.after ? new Date(req.query.after) : null;
        const query = { roomId: room._id.toString(), type: 'public' };
        if (after && !Number.isNaN(after.getTime())) {
            query.createdAt = { $gt: after.toISOString() };
        }

        const messages = await db
            .collection('messages')
            .find(query)
            .sort({ createdAt: 1 })
            .limit(limit)
            .toArray();

        return res.json(messages.map((message) => ({
            id: message._id.toString(),
            username: message.username,
            content: message.content,
            attachment: message.attachment || null,
            createdAt: message.createdAt,
            guest: message.guest || false
        })));
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rooms/public/messages', validateBody, optionalAuth, async (req, res) => {
    try {
        const content = (req.body.content || '').toString().trim();
        const attachment = req.body.attachment || null;
        const captchaId = (req.body.captchaId || '').toString();
        const captchaCode = (req.body.captchaCode || '').toString();
        if (!validateCaptcha(captchaId, captchaCode)) {
            return res.status(400).json({ error: 'Captcha invalid' });
        }
        if (!content && !attachment) {
            return res.status(400).json({ error: 'Content required' });
        }

        const room = await getPublicRoom();
        const db = await getDb();
        const messages = db.collection('messages');

        let username = 'Guest';
        let guest = true;
        if (req.user) {
            username = req.user.displayName || req.user.username;
            guest = false;
        } else if (req.body.guestName) {
            username = req.body.guestName.toString().trim().slice(0, 30) || 'Guest';
        }

        const payload = {
            roomId: room._id.toString(),
            type: 'public',
            username,
            content,
            attachment,
            guest,
            createdAt: new Date().toISOString()
        };

        const result = await messages.insertOne(payload);
        return res.status(201).json({ id: result.insertedId.toString() });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rooms/private', validateBody, authenticateToken, async (req, res) => {
    try {
        const targetUsername = (req.body.username || '').toString().trim();
        if (!targetUsername) {
            return res.status(400).json({ error: 'Username required' });
        }

        const db = await getDb();
        const users = db.collection('users');
        const rooms = db.collection('rooms');

        const target = await users.findOne({ username: normalizeUsername(targetUsername) });
        if (!target) {
            return res.status(404).json({ error: 'User not found' });
        }

        const memberIds = [req.user.userId, target._id.toString()].sort();
        let room = await rooms.findOne({
            type: 'private',
            'members.userId': { $all: memberIds }
        });

        if (!room) {
            const payload = {
                type: 'private',
                name: `DM: ${req.user.displayName || req.user.username} & ${target.displayName || target.username}`,
                members: [
                    { userId: req.user.userId, username: req.user.username, displayName: req.user.displayName },
                    { userId: target._id.toString(), username: target.username, displayName: target.displayName }
                ],
                createdAt: new Date().toISOString()
            };
            const result = await rooms.insertOne(payload);
            room = { ...payload, _id: result.insertedId };
        }

        return res.json({
            id: room._id.toString(),
            name: room.name,
            members: room.members
        });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/rooms/private', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const rooms = await db
            .collection('rooms')
            .find({ type: 'private', 'members.userId': req.user.userId })
            .sort({ createdAt: -1 })
            .toArray();

        return res.json(rooms.map((room) => ({
            id: room._id.toString(),
            name: room.name,
            members: room.members
        })));
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/rooms/:roomId/messages', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const rooms = db.collection('rooms');
        const room = await rooms.findOne({ _id: new ObjectId(req.params.roomId) });
        if (!room || room.type !== 'private') {
            return res.status(404).json({ error: 'Room not found' });
        }
        const isMember = room.members.some((member) => member.userId === req.user.userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const roomId = room._id.toString();
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
        await db.collection('messages').updateMany(
            { roomId, type: 'private' },
            { $addToSet: { readBy: req.user.userId } }
        );

        const messages = await db
            .collection('messages')
            .find({ roomId, type: 'private' })
            .sort({ createdAt: 1 })
            .limit(limit)
            .toArray();

        const otherMemberIds = room.members
            .map((member) => member.userId)
            .filter((id) => id !== req.user.userId);

        const mapped = messages.map((message) => {
            const payload = message.encrypted ? decryptPayload(message.encrypted) : { content: '' };
            const own = isOwnMessage(message, req.user);
            const readBy = Array.isArray(message.readBy) ? message.readBy : [];
            const isRead = own && otherMemberIds.some((id) => readBy.includes(id));
            return {
                id: message._id.toString(),
                username: message.username,
                content: payload.content || '',
                attachment: payload.attachment || null,
                createdAt: message.createdAt,
                status: own ? (isRead ? 'read' : 'send') : null
            };
        });

        return res.json(mapped);
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rooms/:roomId/messages', validateBody, authenticateToken, async (req, res) => {
    try {
        const content = (req.body.content || '').toString().trim();
        const attachment = req.body.attachment || null;
        if (!content && !attachment) {
            return res.status(400).json({ error: 'Content required' });
        }

        const db = await getDb();
        const rooms = db.collection('rooms');
        const room = await rooms.findOne({ _id: new ObjectId(req.params.roomId) });
        if (!room || room.type !== 'private') {
            return res.status(404).json({ error: 'Room not found' });
        }
        const isMember = room.members.some((member) => member.userId === req.user.userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const encrypted = encryptPayload({ content, attachment });
        const payload = {
            roomId: room._id.toString(),
            type: 'private',
            username: req.user.displayName || req.user.username,
            senderId: req.user.userId,
            encrypted,
            readBy: [req.user.userId],
            createdAt: new Date().toISOString()
        };

        const result = await db.collection('messages').insertOne(payload);
        return res.status(201).json({ id: result.insertedId.toString() });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

app.get('/api/rooms/private/unread', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const rooms = await db
            .collection('rooms')
            .find({ type: 'private', 'members.userId': req.user.userId })
            .toArray();

        const results = [];
        for (const room of rooms) {
            const otherMember = room.members.find((member) => member.userId !== req.user.userId);
            if (!otherMember) {
                continue;
            }
            const count = await db.collection('messages').countDocuments({
                roomId: room._id.toString(),
                type: 'private',
                senderId: { $ne: req.user.userId },
                readBy: { $ne: req.user.userId }
            });
            if (count > 0) {
                results.push({
                    username: otherMember.username,
                    count
                });
            }
        }

        return res.json(results);
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rooms/:roomId/read', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const rooms = db.collection('rooms');
        const room = await rooms.findOne({ _id: new ObjectId(req.params.roomId) });
        if (!room || room.type !== 'private') {
            return res.status(404).json({ error: 'Room not found' });
        }
        const isMember = room.members.some((member) => member.userId === req.user.userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await db.collection('messages').updateMany(
            { roomId: room._id.toString(), type: 'private' },
            { $addToSet: { readBy: req.user.userId } }
        );

        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: 'Server error' });
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const userSockets = new Map();

const sendWs = (ws, payload) => {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
    }
};

const broadcastPublic = (payload) => {
    wss.clients.forEach((client) => {
        sendWs(client, payload);
    });
};

const broadcastPrivate = (memberIds, payload) => {
    memberIds.forEach((memberId) => {
        const sockets = userSockets.get(memberId);
        if (!sockets) return;
        sockets.forEach((socket) => sendWs(socket, payload));
    });
};

const attachUserSocket = (userId, ws) => {
    if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(ws);
};

const detachUserSocket = (userId, ws) => {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) {
        userSockets.delete(userId);
    }
};

wss.on('connection', (ws) => {
    const meta = { user: null, rooms: new Set(), guestName: '' };
    clients.set(ws, meta);

    ws.on('message', async (raw) => {
        let payload;
        try {
            payload = JSON.parse(raw.toString());
        } catch (error) {
            return;
        }

        const type = payload.type;

        if (type === 'auth') {
            try {
                jwt.verify(payload.token, JWT_SECRET, (err, user) => {
                    if (err) {
                        sendWs(ws, { type: 'auth_error' });
                        return;
                    }
                    meta.user = user;
                    attachUserSocket(user.userId, ws);
                    sendWs(ws, { type: 'auth_ok', user });
                });
            } catch (error) {
                sendWs(ws, { type: 'auth_error' });
            }
            return;
        }

        if (type === 'join_public') {
            meta.rooms.add('public');
            return;
        }

        if (type === 'public_message') {
            const content = (payload.content || '').toString().trim();
            const attachment = payload.attachment || null;
            const captchaId = (payload.captchaId || '').toString();
            const captchaCode = (payload.captchaCode || '').toString();
            if (!validateCaptcha(captchaId, captchaCode)) {
                sendWs(ws, { type: 'captcha_error', message: 'Captcha invalid' });
                return;
            }
            if (!content && !attachment) return;
            const room = await getPublicRoom();
            const db = await getDb();

            let username = 'Guest';
            let guest = true;
            if (meta.user) {
                username = meta.user.displayName || meta.user.username;
                guest = false;
            } else if (payload.guestName) {
                meta.guestName = payload.guestName.toString().trim().slice(0, 30) || 'Guest';
                username = meta.guestName;
            }

            const message = {
                roomId: room._id.toString(),
                type: 'public',
                username,
                content,
                attachment,
                guest,
                createdAt: new Date().toISOString()
            };
            const result = await db.collection('messages').insertOne(message);
            broadcastPublic({
                type: 'public_message',
                message: { ...message, id: result.insertedId.toString() }
            });
            return;
        }

        if (type === 'join_private') {
            if (!meta.user) return;
            try {
                const db = await getDb();
                const room = await db.collection('rooms').findOne({ _id: new ObjectId(payload.roomId) });
                if (!room || room.type !== 'private') return;
                const isMember = room.members.some((member) => member.userId === meta.user.userId);
                if (!isMember) return;
                meta.rooms.add(payload.roomId);
            } catch (error) {
                return;
            }
            return;
        }

        if (type === 'private_message') {
            if (!meta.user) return;
            const content = (payload.content || '').toString().trim();
            const attachment = payload.attachment || null;
            if (!content && !attachment) return;
            const db = await getDb();
            const room = await db.collection('rooms').findOne({ _id: new ObjectId(payload.roomId) });
            if (!room || room.type !== 'private') return;
            const isMember = room.members.some((member) => member.userId === meta.user.userId);
            if (!isMember) return;

            const encrypted = encryptPayload({ content, attachment });
            const message = {
                roomId: room._id.toString(),
                type: 'private',
                username: meta.user.displayName || meta.user.username,
                senderId: meta.user.userId,
                encrypted,
                readBy: [meta.user.userId],
                createdAt: new Date().toISOString()
            };
            const result = await db.collection('messages').insertOne(message);
            broadcastPrivate(
                room.members.map((member) => member.userId),
                {
                    type: 'private_message',
                    roomId: room._id.toString(),
                    message: {
                        id: result.insertedId.toString(),
                        username: message.username,
                        content,
                        attachment,
                        createdAt: message.createdAt
                    }
                }
            );
            return;
        }

        if (type === 'read') {
            if (!meta.user) return;
            try {
                const db = await getDb();
                const room = await db.collection('rooms').findOne({ _id: new ObjectId(payload.roomId) });
                if (!room || room.type !== 'private') return;
                const isMember = room.members.some((member) => member.userId === meta.user.userId);
                if (!isMember) return;

                await db.collection('messages').updateMany(
                    { roomId: room._id.toString(), type: 'private' },
                    { $addToSet: { readBy: meta.user.userId } }
                );

                const otherMembers = room.members
                    .map((member) => member.userId)
                    .filter((id) => id !== meta.user.userId);

                broadcastPrivate(otherMembers, {
                    type: 'read_receipt',
                    roomId: room._id.toString(),
                    readerId: meta.user.userId
                });
            } catch (error) {
                return;
            }
        }

        if (type === 'typing') {
            const scope = payload.scope;
            const isTyping = !!payload.isTyping;
            const username = meta.user ? (meta.user.displayName || meta.user.username) : (meta.guestName || 'Guest');

            if (scope === 'public') {
                broadcastPublic({ type: 'typing', scope: 'public', username, isTyping });
                return;
            }

            if (scope === 'private' && meta.user) {
                try {
                    const db = await getDb();
                    const room = await db.collection('rooms').findOne({ _id: new ObjectId(payload.roomId) });
                    if (!room || room.type !== 'private') return;
                    const isMember = room.members.some((member) => member.userId === meta.user.userId);
                    if (!isMember) return;
                    broadcastPrivate(
                        room.members.map((member) => member.userId),
                        { type: 'typing', scope: 'private', roomId: room._id.toString(), username, isTyping }
                    );
                } catch (error) {
                    return;
                }
            }
        }
    });

    ws.on('close', () => {
        if (meta.user) {
            detachUserSocket(meta.user.userId, ws);
        }
        clients.delete(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
