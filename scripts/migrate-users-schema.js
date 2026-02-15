/**
 * Migrasi skema users: menambahkan is_active dan is_pro ke dokumen user yang belum memilikinya.
 * Menjalankan: node scripts/migrate-users-schema.js
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || '27017';
const MONGO_DB = process.env.MONGO_DB || 'search-chat';
const MONGO_URL = `mongodb://${MONGO_HOST}:${MONGO_PORT}`;

async function run() {
    const client = new MongoClient(MONGO_URL);
    try {
        await client.connect();
        const db = client.db(MONGO_DB);
        const usersCol = db.collection('users');

        const r1 = await usersCol.updateMany(
            { is_active: { $exists: false } },
            { $set: { is_active: true } }
        );
        const r2 = await usersCol.updateMany(
            { is_pro: { $exists: false } },
            { $set: { is_pro: false } }
        );

        console.log('Migrasi skema users selesai.');
        console.log('  - is_active ditambahkan:', r1.modifiedCount, 'dokumen');
        console.log('  - is_pro ditambahkan:', r2.modifiedCount, 'dokumen');
        console.log('Database:', MONGO_DB, 'di', `${MONGO_HOST}:${MONGO_PORT}`);
    } catch (err) {
        console.error('Error migrasi:', err.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

run();
