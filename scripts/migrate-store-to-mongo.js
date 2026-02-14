/**
 * Migrasi data dari data/store.json ke MongoDB.
 * Menjalankan: node scripts/migrate-store-to-mongo.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || '27017';
const MONGO_DB = process.env.MONGO_DB || 'search-chat';
const MONGO_URL = `mongodb://${MONGO_HOST}:${MONGO_PORT}`;

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

const normalizeUsername = (value) => (value || '').trim().toLowerCase();

async function run() {
    if (!fs.existsSync(STORE_PATH)) {
        console.log('File data/store.json tidak ditemukan. Tidak ada data yang perlu dimigrasi.');
        process.exit(0);
    }

    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    let store;
    try {
        store = JSON.parse(raw);
    } catch (e) {
        console.error('Format data/store.json tidak valid.');
        process.exit(1);
    }

    const client = new MongoClient(MONGO_URL);
    try {
        await client.connect();
        const db = client.db(MONGO_DB);

        const usersCol = db.collection('users');
        const roomsCol = db.collection('rooms');
        const messagesCol = db.collection('messages');

        await usersCol.createIndex({ username: 1 }, { unique: true });
        await roomsCol.createIndex({ type: 1, 'members.userId': 1 });
        await messagesCol.createIndex({ roomId: 1, createdAt: 1 });

        let usersMigrated = 0;
        if (Array.isArray(store.users) && store.users.length > 0) {
            for (const u of store.users) {
                const username = normalizeUsername(u.username || u.id);
                if (!username) continue;
                const existing = await usersCol.findOne({ username });
                if (existing) {
                    console.log('User sudah ada:', username);
                    continue;
                }
                const doc = {
                    username,
                    displayName: (u.username || u.id || '').trim() || username,
                    passwordHash: u.password || u.passwordHash || '',
                    createdAt: u.createdAt || new Date().toISOString()
                };
                await usersCol.insertOne(doc);
                usersMigrated++;
                console.log('User dimigrasi:', doc.displayName);
            }
        }
        console.log('Total user dimigrasi:', usersMigrated);

        let room = await roomsCol.findOne({ type: 'public' });
        if (!room) {
            const payload = {
                type: 'public',
                name: 'Public Room',
                members: [],
                createdAt: new Date().toISOString()
            };
            const result = await roomsCol.insertOne(payload);
            room = { ...payload, _id: result.insertedId };
            console.log('Room public dibuat.');
        } else {
            console.log('Room public sudah ada.');
        }

        if (Array.isArray(store.messages) && store.messages.length > 0) {
            const roomId = room._id.toString();
            const toInsert = store.messages.map((m) => ({
                roomId,
                type: 'public',
                username: m.username || 'Guest',
                content: m.content || '',
                attachment: m.attachment || null,
                guest: m.guest !== false,
                createdAt: m.createdAt || new Date().toISOString()
            }));
            if (toInsert.length > 0) {
                await messagesCol.insertMany(toInsert);
                console.log('Pesan dimigrasi:', toInsert.length);
            }
        }

        console.log('Migrasi selesai. Database:', MONGO_DB, 'di', `${MONGO_HOST}:${MONGO_PORT}`);
    } catch (err) {
        console.error('Error migrasi:', err.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

run();
