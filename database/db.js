// database/db.js - Database connection using sql.js (pure JavaScript SQLite)
// No native compilation required - works on Windows without build tools!

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'bubblebee.db');

let db = null;
let SQL = null;

// Initialize sql.js and load/create database
async function init() {
    if (db) return db;
    
    // Initialize SQL.js
    SQL = await initSqlJs();
    
    // Load existing database or create new one
    try {
        if (fs.existsSync(DB_PATH)) {
            const buffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(buffer);
            console.log('📦 Database loaded from:', DB_PATH);
        } else {
            db = new SQL.Database();
            console.log('📦 New database created');
        }
    } catch (err) {
        console.error('Database load error:', err);
        db = new SQL.Database();
    }
    
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
    
    return db;
}

// Save database to file
function save() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
        console.error('Database save error:', err);
    }
}

// Auto-save every 30 seconds
let saveInterval = null;
function startAutoSave() {
    if (saveInterval) return;
    saveInterval = setInterval(() => {
        if (db) save();
    }, 30000);
}

// Get database instance (must call init() first)
function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call init() first.');
    }
    return db;
}

// Helper to convert row to camelCase
function toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Query helpers
function query(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }
    
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        const camelRow = {};
        for (const key in row) {
            camelRow[toCamelCase(key)] = row[key];
        }
        results.push(camelRow);
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const results = query(sql, params);
    return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
    try {
        db.run(sql, params);
        const changes = db.getRowsModified();
        save(); // Auto-save after write operations
        return { changes };
    } catch (err) {
        console.error('SQL Error:', err.message);
        console.error('SQL:', sql);
        throw err;
    }
}

function insert(table, data) {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    return run(sql, Object.values(data));
}

function update(table, data, where, whereParams = []) {
    const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
    const sql = `UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE ${where}`;
    return run(sql, [...Object.values(data), ...whereParams]);
}

function close() {
    if (saveInterval) {
        clearInterval(saveInterval);
        saveInterval = null;
    }
    if (db) {
        save();
        db.close();
        db = null;
    }
}

// Execute raw SQL (for schema creation)
function exec(sql) {
    db.exec(sql);
    save();
}

module.exports = {
    init,
    getDB,
    query,
    queryOne,
    run,
    insert,
    update,
    close,
    save,
    exec,
    startAutoSave
};
