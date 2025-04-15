// database.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Buat direktori database jika belum ada
if (!fs.existsSync(config.DATABASE_PATH)) {
    fs.mkdirSync(config.DATABASE_PATH, { recursive: true });
}

// Path untuk file admin
const adminPath = path.join(config.DATABASE_PATH, 'admins.json');

// Inisialisasi data admin jika belum ada
if (!fs.existsSync(adminPath)) {
    const initialAdmins = [config.MAIN_ADMIN_ID];
    fs.writeFileSync(adminPath, JSON.stringify(initialAdmins));
}

// Fungsi untuk mendapatkan daftar admin
function getAdmins() {
    const data = fs.readFileSync(adminPath, 'utf8');
    return JSON.parse(data);
}

// Fungsi untuk menambah admin baru
function addAdmin(userId) {
    const admins = getAdmins();
    if (!admins.includes(userId)) {
        admins.push(userId);
        fs.writeFileSync(adminPath, JSON.stringify(admins));
        return true;
    }
    return false;
}

// Fungsi untuk menghapus admin
function removeAdmin(userId) {
    const admins = getAdmins();
    if (userId === config.MAIN_ADMIN_ID) {
        return false; // Admin utama tidak bisa dihapus
    }
    
    const index = admins.indexOf(userId);
    if (index !== -1) {
        admins.splice(index, 1);
        fs.writeFileSync(adminPath, JSON.stringify(admins));
        return true;
    }
    return false;
}

// Fungsi untuk cek apakah user adalah admin
function isAdmin(userId) {
    const admins = getAdmins();
    return admins.includes(userId.toString());
}

// Fungsi untuk menyimpan session user Telegram
const userSessionPath = path.join(config.DATABASE_PATH, 'user_sessions.json');

// Inisialisasi data session jika belum ada
if (!fs.existsSync(userSessionPath)) {
    fs.writeFileSync(userSessionPath, JSON.stringify({}));
}

// Fungsi untuk mendapatkan session user
function getUserSession(userId) {
    const data = fs.readFileSync(userSessionPath, 'utf8');
    const sessions = JSON.parse(data);
    return sessions[userId] || null;
}

// Fungsi untuk menyimpan session user
function saveUserSession(userId, session) {
    const data = fs.readFileSync(userSessionPath, 'utf8');
    const sessions = JSON.parse(data);
    sessions[userId] = session;
    fs.writeFileSync(userSessionPath, JSON.stringify(sessions));
}

// Fungsi untuk menghapus session user
function clearUserSession(userId) {
    const data = fs.readFileSync(userSessionPath, 'utf8');
    const sessions = JSON.parse(data);
    if (sessions[userId]) {
        delete sessions[userId];
        fs.writeFileSync(userSessionPath, JSON.stringify(sessions));
        return true;
    }
    return false;
}

module.exports = {
    getAdmins,
    addAdmin,
    removeAdmin,
    isAdmin,
    getUserSession,
    saveUserSession,
    clearUserSession
};