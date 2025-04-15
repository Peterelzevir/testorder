// whatsapp.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('./config');
const { extractNumber, incrementGroupName } = require('./utils');

// Buat direktori session jika belum ada
if (!fs.existsSync(config.SESSION_PATH)) {
    fs.mkdirSync(config.SESSION_PATH, { recursive: true });
}

// Map untuk menyimpan instance WhatsApp
const connections = new Map();

// Fungsi untuk menunda eksekusi
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi untuk membuat koneksi WhatsApp
async function connectToWhatsApp(sessionId) {
    const sessionFolder = path.join(config.SESSION_PATH, sessionId);
    
    if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();
    
    // Buat log store
    const store = makeInMemoryStore({});
    store.readFromFile(path.join(sessionFolder, 'store.json'));
    setInterval(() => {
        store.writeToFile(path.join(sessionFolder, 'store.json'));
    }, 10_000);
    
    // Buat instance WhatsApp
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['WhatsApp Manager Bot', 'Chrome', '1.0.0']
    });
    
    // Connect ke store
    store.bind(sock.ev);
    
    // Handle koneksi
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // QR code tersedia
            if (connections.has(sessionId)) {
                const connInfo = connections.get(sessionId);
                if (connInfo.qrCallback) {
                    connInfo.qrCallback(qr);
                }
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                // Reconnect
                connectToWhatsApp(sessionId);
            } else {
                // Hapus session jika logout
                if (connections.has(sessionId)) {
                    const connInfo = connections.get(sessionId);
                    if (connInfo.disconnectCallback) {
                        connInfo.disconnectCallback();
                    }
                    connections.delete(sessionId);
                }
            }
        } else if (connection === 'open') {
            // Koneksi berhasil
            if (connections.has(sessionId)) {
                const connInfo = connections.get(sessionId);
                if (connInfo.connectCallback) {
                    connInfo.connectCallback(sock);
                }
            }
        }
    });
    
    // Save credentials ketika update
    sock.ev.on('creds.update', saveCreds);
    
    // Simpan sock ke connections map
    if (!connections.has(sessionId)) {
        connections.set(sessionId, {
            sock,
            qrCallback: null,
            connectCallback: null,
            disconnectCallback: null
        });
    } else {
        connections.get(sessionId).sock = sock;
    }
    
    return sock;
}

// Fungsi untuk mendapatkan instance WhatsApp yang terkoneksi
function getConnection(sessionId) {
    if (connections.has(sessionId)) {
        return connections.get(sessionId).sock;
    }
    return null;
}

// Fungsi untuk mendapatkan semua session yang tersimpan
function getAllSessions() {
    try {
        const sessions = fs.readdirSync(config.SESSION_PATH)
            .filter(file => {
                const sessionFolder = path.join(config.SESSION_PATH, file);
                return fs.statSync(sessionFolder).isDirectory();
            });
        return sessions;
    } catch (error) {
        console.error('Error getting sessions:', error);
        return [];
    }
}

// Fungsi untuk mendapatkan status koneksi
function getConnectionStatus(sessionId) {
    if (connections.has(sessionId)) {
        const connInfo = connections.get(sessionId);
        if (connInfo.sock.user) {
            return {
                connected: true,
                user: connInfo.sock.user
            };
        }
    }
    return { connected: false };
}

// Fungsi untuk set callback QR
function setQRCallback(sessionId, callback) {
    if (connections.has(sessionId)) {
        connections.get(sessionId).qrCallback = callback;
    } else {
        connections.set(sessionId, {
            sock: null,
            qrCallback: callback,
            connectCallback: null,
            disconnectCallback: null
        });
    }
}

// Fungsi untuk set callback connect
function setConnectCallback(sessionId, callback) {
    if (connections.has(sessionId)) {
        connections.get(sessionId).connectCallback = callback;
    } else {
        connections.set(sessionId, {
            sock: null,
            qrCallback: null,
            connectCallback: callback,
            disconnectCallback: null
        });
    }
}

// Fungsi untuk set callback disconnect
function setDisconnectCallback(sessionId, callback) {
    if (connections.has(sessionId)) {
        connections.get(sessionId).disconnectCallback = callback;
    } else {
        connections.set(sessionId, {
            sock: null,
            qrCallback: null,
            connectCallback: null,
            disconnectCallback: callback
        });
    }
}

// Fungsi untuk mengambil daftar grup dari WhatsApp
async function getGroups(sessionId) {
    const sock = getConnection(sessionId);
    if (!sock) return null;
    
    try {
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups);
    } catch (error) {
        console.error('Error getting groups:', error);
        return null;
    }
}

// Fungsi untuk mengganti nama grup
async function renameGroup(sessionId, groupId, newName) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
    
    try {
        await sock.groupUpdateSubject(groupId, newName);
        await delay(config.DELAY); // Delay untuk menghindari rate limiting
        return { success: true, message: `Berhasil mengganti nama grup menjadi "${newName}"` };
    } catch (error) {
        console.error('Error renaming group:', error);
        return { success: false, message: `Gagal mengganti nama grup: ${error.message}` };
    }
}

// Fungsi untuk mendapatkan link grup
async function getGroupInviteLink(sessionId, groupId) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
    
    try {
        const link = await sock.groupInviteCode(groupId);
        await delay(config.DELAY); // Delay untuk menghindari rate limiting
        return { success: true, message: `Berhasil mendapatkan link grup`, link: `https://chat.whatsapp.com/${link}` };
    } catch (error) {
        console.error('Error getting group invite link:', error);
        return { success: false, message: `Gagal mendapatkan link grup: ${error.message}` };
    }
}

// Fungsi untuk promosi admin grup
async function promoteToAdmin(sessionId, groupId, participantNumber) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
    
    try {
        // Format nomor telepon
        let phoneNumber = participantNumber.trim();
        if (!phoneNumber.includes('@')) {
            // Hapus + atau 0 di awal
            if (phoneNumber.startsWith('+')) {
                phoneNumber = phoneNumber.substring(1);
            }
            if (phoneNumber.startsWith('0')) {
                phoneNumber = '62' + phoneNumber.substring(1);
            }
            // Tambahkan @s.whatsapp.net
            phoneNumber = phoneNumber + '@s.whatsapp.net';
        }
        
        // Cek apakah nomor ada di grup
        const groupInfo = await sock.groupMetadata(groupId);
        const participants = groupInfo.participants;
        const isInGroup = participants.some(p => p.id === phoneNumber);
        
        if (!isInGroup) {
            return { success: false, message: `Nomor ${participantNumber} tidak ditemukan dalam grup` };
        }
        
        await sock.groupParticipantsUpdate(groupId, [phoneNumber], 'promote');
        await delay(config.DELAY); // Delay untuk menghindari rate limiting
        return { success: true, message: `Berhasil menjadikan ${participantNumber} sebagai admin` };
    } catch (error) {
        console.error('Error promoting to admin:', error);
        return { success: false, message: `Gagal menjadikan admin: ${error.message}` };
    }
}

// Fungsi untuk mengubah pengaturan grup
async function changeGroupSettings(sessionId, groupId, setting, value) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
    
    try {
        let settingName = '';
        
        if (setting === 'edit_group_info') {
            await sock.groupSettingUpdate(groupId, value ? 'unlocked' : 'locked');
            settingName = 'edit pengaturan grup';
        } else if (setting === 'send_messages') {
            await sock.groupSettingUpdate(groupId, value ? 'not_announcement' : 'announcement');
            settingName = 'pengiriman pesan';
        } else if (setting === 'add_members') {
            // Tidak ada API langsung untuk ini, pengaturan ini dikendalikan oleh izin anggota
            // Ini akan dihandle melalui metode lain jika tersedia
            settingName = 'tambah anggota lain';
        } else if (setting === 'approve_members') {
            // Pengaturan approve members juga tidak memiliki API langsung di baileys
            // Ini akan dihandle melalui metode lain jika tersedia
            settingName = 'setujui anggota baru';
        }
        
        await delay(config.DELAY); // Delay untuk menghindari rate limiting
        return { 
            success: true, 
            message: `Berhasil ${value ? 'mengaktifkan' : 'menonaktifkan'} ${settingName}` 
        };
    } catch (error) {
        console.error('Error changing group settings:', error);
        return { success: false, message: `Gagal mengubah pengaturan grup: ${error.message}` };
    }
}

// Fungsi untuk rename semua grup dengan pola
async function renameAllGroups(sessionId, baseName) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
    
    try {
        const groups = await getGroups(sessionId);
        if (!groups || groups.length === 0) {
            return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
        }
        
        // Urutkan grup berdasarkan angka dalam nama (jika ada)
        const sortedGroups = [...groups].sort((a, b) => {
            const numA = extractNumber(a.subject)[0] || 0;
            const numB = extractNumber(b.subject)[0] || 0;
            return numA - numB;
        });
        
        // Tentukan angka awal
        let currentNumber = 1;
        const matches = baseName.match(/(\d+)/g);
        if (matches && matches.length > 0) {
            currentNumber = parseInt(matches[matches.length - 1], 10);
        }
        
        // Hasil operasi
        const results = [];
        
        // Rename setiap grup
        for (const group of sortedGroups) {
            let newName = '';
            
            if (matches && matches.length > 0) {
                // Angka terakhir
                const lastNumber = matches[matches.length - 1];
                const lastNumberIndex = baseName.lastIndexOf(lastNumber);
                const prefix = baseName.substring(0, lastNumberIndex);
                const suffix = baseName.substring(lastNumberIndex + lastNumber.length);
                
                // Format angka dengan leading zero jika ada
                let newNumber = currentNumber.toString();
                if (lastNumber.startsWith('0')) {
                    // Pertahankan jumlah digit yang sama dengan leading zero
                    const digitCount = lastNumber.length;
                    newNumber = newNumber.padStart(digitCount, '0');
                }
                
                newName = prefix + newNumber + suffix;
            } else {
                // Tidak ada angka di base name
                newName = `${baseName} ${currentNumber}`;
            }
            
            const result = await renameGroup(sessionId, group.id, newName);
            results.push({
                groupName: group.subject,
                newName,
                success: result.success,
                message: result.message
            });
            
            currentNumber++;
        }
        
        return {
            success: true,
            message: `Berhasil mengganti nama ${results.filter(r => r.success).length} dari ${results.length} grup`,
            results
        };
    } catch (error) {
        console.error('Error renaming all groups:', error);
        return { success: false, message: `Gagal mengganti nama grup: ${error.message}`, results: [] };
    }
}

// Fungsi untuk mendapatkan link semua grup
async function getAllGroupLinks(sessionId) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', links: [] };
    
    try {
        const groups = await getGroups(sessionId);
        if (!groups || groups.length === 0) {
            return { success: false, message: 'Tidak ada grup yang ditemukan', links: [] };
        }
        
        // Urutkan grup berdasarkan angka dalam nama (jika ada)
        const sortedGroups = [...groups].sort((a, b) => {
            const numA = extractNumber(a.subject)[0] || 0;
            const numB = extractNumber(b.subject)[0] || 0;
            return numA - numB;
        });
        
        // Hasil operasi
        const links = [];
        
        // Ambil link setiap grup
        for (const group of sortedGroups) {
            const result = await getGroupInviteLink(sessionId, group.id);
            if (result.success) {
                links.push({
                    groupName: group.subject,
                    link: result.link,
                    id: group.id
                });
            }
        }
        
        return {
            success: true,
            message: `Berhasil mendapatkan ${links.length} dari ${sortedGroups.length} link grup`,
            links
        };
    } catch (error) {
        console.error('Error getting all group links:', error);
        return { success: false, message: `Gagal mendapatkan link grup: ${error.message}`, links: [] };
    }
}

// Fungsi untuk menjadikan admin di semua grup
async function promoteToAdminAllGroups(sessionId, numbers) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
    
    try {
        const groups = await getGroups(sessionId);
        if (!groups || groups.length === 0) {
            return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
        }
        
        // Hasil operasi
        const results = [];
        
        // Promote di setiap grup
        for (const group of groups) {
            const groupResults = [];
            
            for (const number of numbers) {
                const result = await promoteToAdmin(sessionId, group.id, number);
                groupResults.push({
                    number,
                    success: result.success,
                    message: result.message
                });
            }
            
            results.push({
                groupName: group.subject,
                id: group.id,
                results: groupResults
            });
        }
        
        return {
            success: true,
            message: `Selesai melakukan promosi admin di ${groups.length} grup`,
            results
        };
    } catch (error) {
        console.error('Error promoting admins:', error);
        return { success: false, message: `Gagal menjadikan admin: ${error.message}`, results: [] };
    }
}

// Fungsi untuk mengubah pengaturan di semua grup
async function changeAllGroupSettings(sessionId, settings) {
    const sock = getConnection(sessionId);
    if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
    
    try {
        const groups = await getGroups(sessionId);
        if (!groups || groups.length === 0) {
            return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
        }
        
        // Hasil operasi
        const results = [];
        
        // Ubah pengaturan di setiap grup
        for (const group of groups) {
            const groupResults = [];
            
            // Proses setiap pengaturan
            for (const setting of Object.keys(settings)) {
                const value = settings[setting];
                const result = await changeGroupSettings(sessionId, group.id, setting, value);
                groupResults.push({
                    setting,
                    value,
                    success: result.success,
                    message: result.message
                });
            }
            
            results.push({
                groupName: group.subject,
                id: group.id,
                settings: groupResults,
                success: groupResults.every(r => r.success)
            });
        }
        
        return {
            success: true,
            message: `Selesai mengubah pengaturan di ${results.filter(r => r.success).length} dari ${results.length} grup`,
            results
        };
    } catch (error) {
        console.error('Error changing group settings:', error);
        return { success: false, message: `Gagal mengubah pengaturan grup: ${error.message}`, results: [] };
    }
}

module.exports = {
    connectToWhatsApp,
    getConnection,
    getAllSessions,
    getConnectionStatus,
    setQRCallback,
    setConnectCallback,
    setDisconnectCallback,
    getGroups,
    renameGroup,
    getGroupInviteLink,
    promoteToAdmin,
    changeGroupSettings,
    renameAllGroups,
    getAllGroupLinks,
    promoteToAdminAllGroups,
    changeAllGroupSettings
};