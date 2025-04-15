// hiyaok coding @hiyaok on telegram
const { Telegraf, Markup, session, Scenes } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./database');
const wa = require('./whatsapp');
const utils = require('./utils');

// Buat bot
const bot = new Telegraf(config.BOT_TOKEN);

// Set middleware
bot.use(session());

// Middleware untuk cek admin
async function adminMiddleware(ctx, next) {
    const userId = ctx.from.id.toString();
    if (!db.isAdmin(userId)) {
        await ctx.reply('⛔ Anda tidak memiliki izin untuk menggunakan bot ini.');
        return;
    }
    return next();
}

// ============== SCENE SETUP ============== //

// Buat wizard scene untuk connect wa
const connectWAScene = new Scenes.WizardScene(
    'connect_wa',
    async (ctx) => {
        // Step 1: Minta nama session
        ctx.wizard.state.data = {};
        await ctx.reply('📝 Masukkan nama untuk session WhatsApp baru:', 
            Markup.keyboard([['❌ Batal']])
            .resize()
            .oneTime()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Proses nama session
        if (ctx.message.text === '❌ Batal') {
            await ctx.reply('Operasi dibatalkan', Markup.removeKeyboard());
            return ctx.scene.leave();
        }
        
        const sessionId = ctx.message.text.trim();
        if (sessionId.includes(' ') || sessionId.includes('/') || sessionId.length < 3) {
            await ctx.reply('❌ Nama session tidak valid. Gunakan minimal 3 karakter tanpa spasi dan karakter khusus.');
            return;
        }
        
        ctx.wizard.state.data.sessionId = sessionId;
        
        // Kirim loading message
        const loadingMsg = await ctx.reply('⏳ Memulai session WhatsApp, harap tunggu...');
        
        // Setup callback untuk QR code
        wa.setQRCallback(sessionId, async (qr) => {
            try {
                // Generate QR code sebagai gambar
                const qrBuffer = await QRCode.toBuffer(qr);
                
                // Kirim QR code
                await ctx.replyWithPhoto({ source: qrBuffer }, {
                    caption: '📱 Scan QR code ini dengan WhatsApp Anda untuk login\n\nPetunjuk:\n1. Buka WhatsApp di HP Anda\n2. Tap Menu > WhatsApp Web\n3. Scan QR code ini'
                });
                
                // Update message
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    '🔄 Menunggu scan QR code...'
                );
            } catch (error) {
                console.error('Error generating QR code:', error);
            }
        });
        
        // Setup callback untuk koneksi berhasil
        wa.setConnectCallback(sessionId, async (sock) => {
            try {
                const status = wa.getConnectionStatus(sessionId);
                if (status.connected && status.user) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        loadingMsg.message_id,
                        null,
                        `✅ Berhasil terhubung ke WhatsApp!\n\nNama: ${status.user.name}\nNomor: ${status.user.id.split('@')[0]}`
                    );
                    
                    // Kirim menu utama
                    await ctx.reply('✅ WhatsApp berhasil terhubung!', 
                        Markup.removeKeyboard()
                    );
                    
                    // Keluar dari scene
                    ctx.scene.leave();
                }
            } catch (error) {
                console.error('Error handling connection:', error);
            }
        });
        
        // Setup callback untuk disconnect
        wa.setDisconnectCallback(sessionId, async () => {
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    '❌ Koneksi terputus dari WhatsApp'
                );
                
                // Keluar dari scene
                ctx.scene.leave();
            } catch (error) {
                console.error('Error handling disconnect:', error);
            }
        });
        
        // Mulai koneksi
        await wa.connectToWhatsApp(sessionId);
        
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 3: Menunggu scan QR
        if (ctx.message && ctx.message.text === '❌ Batal') {
            await ctx.reply('Operasi dibatalkan', Markup.removeKeyboard());
            return ctx.scene.leave();
        }
        return;
    }
);

// Scene untuk rename semua grup
const renameGroupsScene = new Scenes.WizardScene(
    'rename_groups',
    async (ctx) => {
        // Step 1: Minta nama dasar grup
        const sessionId = ctx.scene.state.sessionId;
        ctx.wizard.state.data = { sessionId };
        
        await ctx.reply('📝 Masukkan nama dasar untuk grup (contoh: "DATA 001"):', 
            Markup.keyboard([['❌ Batal']])
            .resize()
            .oneTime()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Lakukan rename grup
        if (ctx.message.text === '❌ Batal') {
            await ctx.reply('Operasi dibatalkan', Markup.removeKeyboard());
            return ctx.scene.leave();
        }
        
        const baseName = ctx.message.text.trim();
        ctx.wizard.state.data.baseName = baseName;
        
        // Kirim loading message
        const loadingMsg = await ctx.reply('⏳ Mengganti nama grup, harap tunggu...');
        
        try {
            const { sessionId } = ctx.wizard.state.data;
            const result = await wa.renameAllGroups(sessionId, baseName);
            
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ ${result.message}`
                );
                
                // Buat rangkuman hasil
                let summary = '📋 *Hasil Rename Grup:*\n\n';
                
                for (const item of result.results) {
                    const status = item.success ? '✅' : '❌';
                    summary += `${status} ${item.groupName} → ${item.newName}\n`;
                }
                
                if (summary.length > 4000) {
                    // Kirim sebagai file jika terlalu panjang
                    const filePath = await utils.createTextFile(summary, 'rename_results.txt');
                    await ctx.replyWithDocument({ source: filePath }, { 
                        caption: '📋 Hasil Rename Grup (terlalu panjang)' 
                    });
                    // Hapus file temp
                    fs.unlinkSync(filePath);
                } else {
                    await ctx.replyWithMarkdown(summary);
                }
                
                await showManageGroupMenu(ctx, sessionId);
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ ${result.message}`
                );
            }
        } catch (error) {
            console.error('Error renaming groups:', error);
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ Terjadi kesalahan: ${error.message}`
            );
        }
        
        // Keluar dari scene
        return ctx.scene.leave();
    }
);

// Scene untuk ambil link grup
const getGroupLinksScene = new Scenes.WizardScene(
    'get_group_links',
    async (ctx) => {
        // Langsung menjalankan tanpa step tambahan
        const sessionId = ctx.scene.state.sessionId;
        
        // Kirim loading message
        const loadingMsg = await ctx.reply('⏳ Mengambil link grup, harap tunggu...');
        
        try {
            const result = await wa.getAllGroupLinks(sessionId);
            
            if (result.success) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `✅ ${result.message}`
                );
                
                // Buat rangkuman hasil
                let linkText = '🔗 *Link Grup:*\n\n';
                
                for (const item of result.links) {
                    linkText += `*${item.groupName}*\n${item.link}\n\n`;
                }
                
                if (linkText.length > 4000 || result.links.length > 20) {
                    // Kirim sebagai file jika terlalu panjang
                    const filePath = await utils.createTextFile(linkText, 'group_links.txt');
                    await ctx.replyWithDocument({ source: filePath }, { 
                        caption: '🔗 Link Grup (terlalu banyak)',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⏭️ Lanjut ke Step Berikutnya', callback_data: `next_step_admin_${sessionId}` }]
                            ]
                        }
                    });
                    // Hapus file temp
                    fs.unlinkSync(filePath);
                } else {
                    await ctx.replyWithMarkdown(linkText, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⏭️ Lanjut ke Step Berikutnya', callback_data: `next_step_admin_${sessionId}` }]
                            ]
                        }
                    });
                }
            } else {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ ${result.message}`
                );
                
                await ctx.reply('⏭️ Lanjut ke step berikutnya?', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Ya', callback_data: `next_step_admin_${sessionId}` }],
                            [{ text: 'Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                        ]
                    }
                });
            }
        } catch (error) {
            console.error('Error getting group links:', error);
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ Terjadi kesalahan: ${error.message}`
            );
            
            await ctx.reply('⏭️ Lanjut ke step berikutnya?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Ya', callback_data: `next_step_admin_${sessionId}` }],
                        [{ text: 'Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                    ]
                }
            });
        }
        
        // Keluar dari scene
        return ctx.scene.leave();
    }
);

// Scene untuk tambah admin grup
const promoteAdminScene = new Scenes.WizardScene(
    'promote_admin',
    async (ctx) => {
        // Step 1: Minta nomor admin
        const sessionId = ctx.scene.state.sessionId;
        ctx.wizard.state.data = { sessionId, numbers: [] };
        
        await ctx.reply(
            '📱 Masukkan nomor telepon yang akan dijadikan admin di semua grup.\n\n' +
            'Anda dapat memasukkan beberapa nomor, satu per baris.\n' +
            'Format: 6281234567890 atau 081234567890',
            Markup.keyboard([['✅ Selesai'], ['❌ Batal']])
            .resize()
            .oneTime()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Proses nomor atau selesai
        if (ctx.message.text === '❌ Batal') {
            await ctx.reply('Operasi dibatalkan', Markup.removeKeyboard());
            return ctx.scene.leave();
        }
        
        if (ctx.message.text === '✅ Selesai') {
            // Proses jika semua nomor telah dimasukkan
            const { numbers } = ctx.wizard.state.data;
            
            if (numbers.length === 0) {
                await ctx.reply('❌ Anda belum memasukkan nomor telepon.');
                return;
            }
            
            // Konfirmasi nomor yang akan dijadikan admin
            let confirmMessage = '📋 *Nomor yang akan dijadikan admin:*\n\n';
            for (const number of numbers) {
                confirmMessage += `📱 ${number}\n`;
            }
            
            confirmMessage += '\nLanjutkan?';
            
            await ctx.replyWithMarkdown(confirmMessage, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Ya', callback_data: 'confirm_promote' }],
                        [{ text: '❌ Tidak', callback_data: 'cancel_promote' }]
                    ]
                }
            });
            
            return ctx.wizard.next();
        }
        
        // Proses nomor
        const inputNumbers = ctx.message.text.trim().split(/\s+/);
        
        for (const number of inputNumbers) {
            // Validasi format nomor
            if (/^\+?[0-9]{10,15}$/.test(number)) {
                ctx.wizard.state.data.numbers.push(utils.formatPhoneNumber(number));
            } else {
                await ctx.reply(`❌ Nomor tidak valid: ${number}. Silakan masukkan nomor valid.`);
            }
        }
        
        // Beri tahu jumlah nomor yang sudah ditambahkan
        const { numbers } = ctx.wizard.state.data;
        await ctx.reply(
            `✅ ${numbers.length} nomor telah ditambahkan.\n\n` +
            'Masukkan nomor lain atau pilih "✅ Selesai" jika sudah.'
        );
        
        return;
    },
    async (ctx) => {
        // Step 3: Konfirmasi dan proses
        if (!ctx.callbackQuery) return;
        
        const action = ctx.callbackQuery.data;
        
        if (action === 'cancel_promote') {
            await ctx.reply('Operasi dibatalkan', Markup.removeKeyboard());
            return ctx.scene.leave();
        }
        
        if (action === 'confirm_promote') {
            const { sessionId, numbers } = ctx.wizard.state.data;
            
            // Kirim loading message
            const loadingMsg = await ctx.reply('⏳ Menjadikan admin di semua grup, harap tunggu...');
            
            try {
                const result = await wa.promoteToAdminAllGroups(sessionId, numbers);
                
                if (result.success) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        loadingMsg.message_id,
                        null,
                        `✅ ${result.message}`
                    );
                    
                    // Buat rangkuman hasil
                    let summary = '📋 *Hasil Promosi Admin:*\n\n';
                    let successCount = 0;
                    let failedCount = 0;
                    
                    for (const group of result.results) {
                        summary += `*Grup: ${group.groupName}*\n`;
                        
                        for (const item of group.results) {
                            const status = item.success ? '✅' : '❌';
                            summary += `${status} ${item.number}: ${item.success ? 'Berhasil' : 'Gagal'}\n`;
                            
                            if (item.success) successCount++;
                            else failedCount++;
                        }
                        
                        summary += '\n';
                    }
                    
                    summary += `Total: ${successCount} berhasil, ${failedCount} gagal`;
                    
                    if (summary.length > 4000) {
                        // Kirim sebagai file jika terlalu panjang
                        const filePath = await utils.createTextFile(summary, 'admin_promotion_results.txt');
                        await ctx.replyWithDocument({ source: filePath }, { 
                            caption: '📋 Hasil Promosi Admin (terlalu panjang)',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Step Berikutnya', callback_data: `next_step_setting_${sessionId}` }]
                                ]
                            }
                        });
                        // Hapus file temp
                        fs.unlinkSync(filePath);
                    } else {
                        await ctx.replyWithMarkdown(summary, {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '⏭️ Lanjut ke Step Berikutnya', callback_data: `next_step_setting_${sessionId}` }]
                                ]
                            }
                        });
                    }
                } else {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        loadingMsg.message_id,
                        null,
                        `❌ ${result.message}`
                    );
                    
                    await ctx.reply('⏭️ Lanjut ke step berikutnya?', {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Ya', callback_data: `next_step_setting_${sessionId}` }],
                                [{ text: 'Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                            ]
                        }
                    });
                }
            } catch (error) {
                console.error('Error promoting admins:', error);
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    `❌ Terjadi kesalahan: ${error.message}`
                );
                
                await ctx.reply('⏭️ Lanjut ke step berikutnya?', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Ya', callback_data: `next_step_setting_${sessionId}` }],
                            [{ text: 'Kembali ke Menu', callback_data: `manage_groups_${sessionId}` }]
                        ]
                    }
                });
            }
            
            // Keluar dari scene
            return ctx.scene.leave();
        }
    }
);

// Scene untuk mengubah pengaturan grup
const changeSettingsScene = new Scenes.WizardScene(
    'change_settings',
    async (ctx) => {
        // Step 1: Tampilkan pengaturan saat ini dan minta input
        const sessionId = ctx.scene.state.sessionId;
        ctx.wizard.state.data = { 
            sessionId,
            settings: {
                'edit_group_info': false,  // Default: OFF (sesuai permintaan)
                'send_messages': true,     // Default: ON (sesuai permintaan)
                'add_members': true,       // Default: ON (sesuai permintaan)
                'approve_members': true    // Default: ON (sesuai permintaan)
            }
        };
        
        await ctx.replyWithMarkdown(
            '⚙️ *Pengaturan Grup yang akan diterapkan:*\n\n' +
            '1. Edit Pengaturan Grup: OFF ❌\n' +
            '2. Kirim Pesan: ON ✅\n' +
            '3. Tambah Anggota Lain: ON ✅\n' +
            '4. Setujui Anggota Baru: ON ✅\n\n' +
            'Pengaturan ini akan diterapkan ke semua grup. Apakah ingin melanjutkan?',
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Terapkan', callback_data: 'apply_settings' },
                            { text: '❌ Batal', callback_data: 'cancel_settings' }
                        ],
                        [
                            { text: '1️⃣ Toggle Edit Info', callback_data: 'toggle_edit_info' },
                            { text: '2️⃣ Toggle Kirim Pesan', callback_data: 'toggle_send_messages' }
                        ],
                        [
                            { text: '3️⃣ Toggle Tambah Anggota', callback_data: 'toggle_add_members' },
                            { text: '4️⃣ Toggle Setujui Anggota', callback_data: 'toggle_approve_members' }
                        ]
                    ]
                }
            }
        );
        
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Proses toggle pengaturan atau apply
        if (!ctx.callbackQuery) return;
        
        const action = ctx.callbackQuery.data;
        
        if (action === 'cancel_settings') {
            await ctx.answerCbQuery('Pengaturan dibatalkan');
            await ctx.reply('Operasi dibatalkan');
            return ctx.scene.leave();
        }
        
        if (action === 'toggle_edit_info') {
            ctx.wizard.state.data.settings.edit_group_info = !ctx.wizard.state.data.settings.edit_group_info;
        } else if (action === 'toggle_send_messages') {
            ctx.wizard.state.data.settings.send_messages = !ctx.wizard.state.data.settings.send_messages;
        } else if (action === 'toggle_add_members') {
            ctx.wizard.state.data.settings.add_members = !ctx.wizard.state.data.settings.add_members;
        } else if (action === 'toggle_approve_members') {
            ctx.wizard.state.data.settings.approve_members = !ctx.wizard.state.data.settings.approve_members;
        } else if (action === 'apply_settings') {
            // Lanjut ke proses penerapan pengaturan
            await ctx.answerCbQuery('Menerapkan pengaturan...');
            return await applySettings(ctx);
        }
        
        // Update tampilan pengaturan jika ada toggle
        if (action.startsWith('toggle_')) {
            await ctx.answerCbQuery('Pengaturan diubah');
            
            const { edit_group_info, send_messages, add_members, approve_members } = ctx.wizard.state.data.settings;
            
            await ctx.editMessageText(
                '⚙️ *Pengaturan Grup yang akan diterapkan:*\n\n' +
                `1. Edit Pengaturan Grup: ${edit_group_info ? 'ON ✅' : 'OFF ❌'}\n` +
                `2. Kirim Pesan: ${send_messages ? 'ON ✅' : 'OFF ❌'}\n` +
                `3. Tambah Anggota Lain: ${add_members ? 'ON ✅' : 'OFF ❌'}\n` +
                `4. Setujui Anggota Baru: ${approve_members ? 'ON ✅' : 'OFF ❌'}\n\n` +
                'Pengaturan ini akan diterapkan ke semua grup. Apakah ingin melanjutkan?',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Terapkan', callback_data: 'apply_settings' },
                                { text: '❌ Batal', callback_data: 'cancel_settings' }
                            ],
                            [
                                { text: '1️⃣ Toggle Edit Info', callback_data: 'toggle_edit_info' },
                                { text: '2️⃣ Toggle Kirim Pesan', callback_data: 'toggle_send_messages' }
                            ],
                            [
                                { text: '3️⃣ Toggle Tambah Anggota', callback_data: 'toggle_add_members' },
                                { text: '4️⃣ Toggle Setujui Anggota', callback_data: 'toggle_approve_members' }
                            ]
                        ]
                    }
                }
            );
        }
        
        return;
    }
);

// Fungsi helper untuk menerapkan pengaturan
async function applySettings(ctx) {
    const { sessionId, settings } = ctx.wizard.state.data;
    
    // Kirim loading message
    const loadingMsg = await ctx.reply('⏳ Menerapkan pengaturan grup, harap tunggu...');
    
    try {
        const result = await wa.changeAllGroupSettings(sessionId, settings);
        
        if (result.success) {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `✅ ${result.message}`
            );
            
            // Buat rangkuman hasil
            let summary = '📋 *Hasil Pengaturan Grup:*\n\n';
            let successCount = 0;
            let failedCount = 0;
            
            for (const group of result.results) {
                const status = group.success ? '✅' : '❌';
                summary += `${status} ${group.groupName}\n`;
                
                // Detail pengaturan yang diterapkan
                const settingsApplied = [];
                if (settings.edit_group_info === false) {
                    settingsApplied.push('Edit Info: OFF');
                }
                if (settings.send_messages === true) {
                    settingsApplied.push('Kirim Pesan: ON');
                }
                if (settings.add_members === true) {
                    settingsApplied.push('Tambah Anggota: ON');
                }
                if (settings.approve_members === true) {
                    settingsApplied.push('Setujui Anggota: ON');
                }
                
                summary += `   (${settingsApplied.join(', ')})\n`;
                
                if (group.success) successCount++;
                else failedCount++;
            }
            
            summary += `\nTotal: ${successCount} berhasil, ${failedCount} gagal`;
            
            if (summary.length > 4000) {
                // Kirim sebagai file jika terlalu panjang
                const filePath = await utils.createTextFile(summary, 'settings_results.txt');
                await ctx.replyWithDocument({ source: filePath }, { 
                    caption: '📋 Hasil Pengaturan Grup (terlalu panjang)',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Selesai', callback_data: `manage_groups_${sessionId}` }]
                        ]
                    }
                });
                // Hapus file temp
                fs.unlinkSync(filePath);
            } else {
                await ctx.replyWithMarkdown(summary, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Selesai', callback_data: `manage_groups_${sessionId}` }]
                        ]
                    }
                });
            }
        } else {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                `❌ ${result.message}`
            );
            
            await ctx.reply('Kembali ke menu?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Ya', callback_data: `manage_groups_${sessionId}` }]
                    ]
                }
            });
        }
    } catch (error) {
        console.error('Error changing settings:', error);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            loadingMsg.message_id,
            null,
            `❌ Terjadi kesalahan: ${error.message}`
        );
        
        await ctx.reply('Kembali ke menu?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Ya', callback_data: `manage_groups_${sessionId}` }]
                ]
            }
        });
    }
    
    // Keluar dari scene
    return ctx.scene.leave();
}

// Scene untuk tambah admin bot
const addBotAdminScene = new Scenes.WizardScene(
    'add_bot_admin',
    async (ctx) => {
        // Step 1: Minta ID admin baru
        await ctx.reply(
            '📝 Masukkan ID Telegram user yang akan dijadikan admin bot:\n\n' +
            'Catatan: User perlu mengirimi pesan ke bot ini terlebih dahulu agar ID-nya dapat digunakan.'
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Verifikasi dan tambahkan admin baru
        if (!ctx.message.text) {
            await ctx.reply('❌ Harap masukkan ID Telegram.');
            return;
        }
        
        const adminId = ctx.message.text.trim();
        
        // Validasi ID
        if (!/^\d+$/.test(adminId)) {
            await ctx.reply('❌ ID tidak valid. ID Telegram harus berupa angka.');
            return ctx.wizard.back();
        }
        
        // Tambahkan admin
        const added = db.addAdmin(adminId);
        
        if (added) {
            await ctx.reply(`✅ Berhasil menambahkan admin dengan ID: ${adminId}`);
        } else {
            await ctx.reply(`⚠️ User dengan ID ${adminId} sudah menjadi admin.`);
        }
        
        // Tampilkan daftar admin
        const admins = db.getAdmins();
        let adminList = '👮‍♂️ *Daftar Admin Bot:*\n\n';
        
        for (const id of admins) {
            adminList += `• ${id}${id === config.MAIN_ADMIN_ID ? ' (Admin Utama)' : ''}\n`;
        }
        
        await ctx.replyWithMarkdown(adminList);
        
        // Keluar dari scene
        return ctx.scene.leave();
    }
);

// Buat stage
const stage = new Scenes.Stage([
    connectWAScene, 
    renameGroupsScene, 
    getGroupLinksScene,
    promoteAdminScene,
    changeSettingsScene,
    addBotAdminScene
]);
bot.use(stage.middleware());

// ============== HELPER FUNCTIONS ============== //

// Fungsi untuk menampilkan menu utama
async function showMainMenu(ctx) {
    // Ambil semua session
    const sessions = wa.getAllSessions();
    const buttons = [];
    
    // Tambahkan button untuk setiap session
    if (sessions.length > 0) {
        for (const session of sessions) {
            const status = wa.getConnectionStatus(session);
            const emoji = status.connected ? '🟢' : '🔴';
            const label = status.connected ? 
                `${emoji} ${session} (${status.user.name})` : 
                `${emoji} ${session} (Tidak Terhubung)`;
            
            buttons.push([Markup.button.callback(label, `select_session_${session}`)]);
        }
    }
    
    // Tambahkan button untuk tambah session baru dan mengelola admin
    buttons.push([Markup.button.callback('➕ Tambah Session Baru', 'add_session')]);
    buttons.push([Markup.button.callback('👮‍♂️ Kelola Admin Bot', 'manage_admins')]);
    
    // Kirim menu
    await ctx.reply(
        '🤖 *Menu Utama*\n\n' + 
        'Silakan pilih session WhatsApp atau tambahkan session baru:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        }
    );
}

// Fungsi untuk menampilkan menu kelola grup
async function showManageGroupMenu(ctx, sessionId) {
    await ctx.reply(
        `🏠 *Menu Kelola Grup*\n` +
        `Session: ${sessionId}\n\n` +
        'Pilih menu:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('1️⃣ Ganti Nama Grup', `rename_groups_${sessionId}`)],
                [Markup.button.callback('2️⃣ Ambil Link Grup', `get_group_links_${sessionId}`)],
                [Markup.button.callback('3️⃣ Tambah Admin Grup', `promote_admin_${sessionId}`)],
                [Markup.button.callback('4️⃣ Nonaktifkan Edit Info Grup', `change_settings_${sessionId}`)],
                [Markup.button.callback('📲 Kelola Session Lain', 'main_menu')],
                [Markup.button.callback('🔄 Mulai Semua Langkah', `start_all_steps_${sessionId}`)]
            ])
        }
    );
}

// ============== BOT HANDLERS ============== //

// Handler untuk command /start
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    if (!db.isAdmin(userId)) {
        await ctx.reply(
            '👋 Selamat datang di WA Manager Bot!\n\n' +
            'Bot ini hanya dapat digunakan oleh admin yang ditunjuk.',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👤 Minta Akses Admin', callback_data: 'request_admin' }]
                    ]
                }
            }
        );
        return;
    }
    
    // Reset session user
    db.clearUserSession(userId);
    
    // Tampilkan menu utama
    await ctx.reply(
        '👋 Selamat datang di WA Manager Bot!\n\n' +
        'Bot ini memungkinkan Anda untuk mengelola grup WhatsApp. ' +
        'Gunakan menu di bawah untuk memulai.'
    );
    
    await showMainMenu(ctx);
});

// Handler untuk command /menu
bot.command('menu', adminMiddleware, async (ctx) => {
    await showMainMenu(ctx);
});

// Handler untuk button main_menu
bot.action('main_menu', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await showMainMenu(ctx);
});

// Handler untuk button add_session
bot.action('add_session', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('connect_wa');
});

// Handler untuk button select_session
bot.action(/select_session_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Cek status koneksi
    const status = wa.getConnectionStatus(sessionId);
    
    if (!status.connected) {
        // Jika tidak terhubung, tawarkan untuk rekoneksi
        await ctx.reply(
            `⚠️ Session ${sessionId} tidak terhubung ke WhatsApp.\n\n` +
            'Silakan pilih tindakan:',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Hubungkan Kembali', callback_data: `reconnect_${sessionId}` }],
                        [{ text: '🗑️ Hapus Session', callback_data: `delete_session_${sessionId}` }],
                        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
        return;
    }
    
    // Jika terhubung, tampilkan menu kelola grup
    await showManageGroupMenu(ctx, sessionId);
});

// Handler untuk button reconnect
bot.action(/reconnect_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai proses connect
    await ctx.scene.enter('connect_wa');
});

// Handler untuk button delete_session
bot.action(/delete_session_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Konfirmasi penghapusan
    await ctx.reply(
        `⚠️ Anda yakin ingin menghapus session ${sessionId}?\n\n` +
        'Tindakan ini tidak dapat dibatalkan!',
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Ya, Hapus', callback_data: `confirm_delete_${sessionId}` }],
                    [{ text: '❌ Tidak', callback_data: 'main_menu' }]
                ]
            }
        }
    );
});

// Handler untuk button confirm_delete
bot.action(/confirm_delete_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
        // Hapus direktori session
        const sessionFolder = path.join(config.SESSION_PATH, sessionId);
        if (fs.existsSync(sessionFolder)) {
            fs.rmdirSync(sessionFolder, { recursive: true });
        }
        
        await ctx.reply(`✅ Session ${sessionId} berhasil dihapus.`);
        await showMainMenu(ctx);
    } catch (error) {
        console.error('Error deleting session:', error);
        await ctx.reply(`❌ Gagal menghapus session: ${error.message}`);
    }
});

// Handler untuk button rename_groups
bot.action(/rename_groups_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene rename grup
    await ctx.scene.enter('rename_groups');
});

// Handler untuk button get_group_links
bot.action(/get_group_links_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene get group links
    await ctx.scene.enter('get_group_links');
});

// Handler untuk button next_step_admin
bot.action(/next_step_admin_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene promote admin
    await ctx.scene.enter('promote_admin');
});

// Handler untuk button promote_admin
bot.action(/promote_admin_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene promote admin
    await ctx.scene.enter('promote_admin');
});

// Handler untuk button next_step_setting
bot.action(/next_step_setting_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene change settings
    await ctx.reply(
        '🔄 *Langkah Berikutnya:* Pengaturan Grup\n\n' +
        'Anda akan mengatur izin grup sesuai dengan gambar contoh:\n' +
        '• Edit Pengaturan Grup: OFF ❌\n' +
        '• Kirim Pesan: ON ✅\n' +
        '• Tambah Anggota Lain: ON ✅\n' +
        '• Setujui Anggota Baru: ON ✅',
        { parse_mode: 'Markdown' }
    );
    
    await ctx.scene.enter('change_settings');
});

// Handler untuk button change_settings
bot.action(/change_settings_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene change settings
    await ctx.scene.enter('change_settings');
});

// Handler untuk button start_all_steps
bot.action(/start_all_steps_(.+)/, adminMiddleware, async (ctx) => {
    const sessionId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Simpan session ID di context
    ctx.scene.state = { sessionId };
    
    // Mulai scene rename groups (langkah 1)
    await ctx.reply(
        '🚀 *Memulai Semua Langkah*\n\n' +
        '*Step 1:* Ganti Nama Grup'
    );
    
    await ctx.scene.enter('rename_groups');
});

// Handler untuk button manage_admins
bot.action('manage_admins', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    
    // Tampilkan daftar admin
    const admins = db.getAdmins();
    let adminList = '👮‍♂️ *Daftar Admin Bot:*\n\n';
    
    for (const id of admins) {
        adminList += `• ${id}${id === config.MAIN_ADMIN_ID ? ' (Admin Utama)' : ''}\n`;
    }
    
    await ctx.replyWithMarkdown(adminList, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Tambah Admin', callback_data: 'add_admin' }],
                [{ text: '🗑️ Hapus Admin', callback_data: 'remove_admin' }],
                [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
            ]
        }
    });
});

// Handler untuk button add_admin
bot.action('add_admin', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    
    // Masuk ke scene add bot admin
    await ctx.scene.enter('add_bot_admin');
});

// Handler untuk button remove_admin
bot.action('remove_admin', adminMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    
    // Ambil daftar admin
    const admins = db.getAdmins();
    const buttons = [];
    
    // Buat button untuk setiap admin (kecuali admin utama)
    for (const id of admins) {
        if (id !== config.MAIN_ADMIN_ID) {
            buttons.push([Markup.button.callback(`🗑️ ${id}`, `delete_admin_${id}`)]);
        }
    }
    
    buttons.push([Markup.button.callback('🔙 Kembali', 'manage_admins')]);
    
    await ctx.reply(
        '🗑️ *Hapus Admin*\n\n' +
        'Pilih admin yang akan dihapus:',
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        }
    );
});

// Handler untuk button delete_admin
bot.action(/delete_admin_(.+)/, adminMiddleware, async (ctx) => {
    const adminId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Hapus admin
    const removed = db.removeAdmin(adminId);
    
    if (removed) {
        await ctx.reply(`✅ Berhasil menghapus admin dengan ID: ${adminId}`);
    } else {
        await ctx.reply(`❌ Gagal menghapus admin. Admin utama tidak dapat dihapus.`);
    }
    
    // Kembali ke menu manage admins
    ctx.answerCbQuery();
    ctx.callbackQuery.data = 'manage_admins';
    return bot.handleUpdate({
        ...ctx.update,
        callback_query: ctx.callbackQuery
    });
});

// Handler untuk button request_admin
bot.action('request_admin', async (ctx) => {
    await ctx.answerCbQuery();
    
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : 'tidak ada username';
    
    // Kirim notifikasi ke admin utama
    try {
        await bot.telegram.sendMessage(
            config.MAIN_ADMIN_ID,
            `🔔 *Permintaan Akses Admin*\n\n` +
            `User ID: ${userId}\n` +
            `Username: ${username}\n` +
            `Nama: ${ctx.from.first_name} ${ctx.from.last_name || ''}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Terima', callback_data: `accept_admin_${userId}` }],
                        [{ text: '❌ Tolak', callback_data: `reject_admin_${userId}` }]
                    ]
                }
            }
        );
        
        await ctx.reply(
            '✅ Permintaan akses admin telah dikirim ke admin utama.\n\n' +
            'Anda akan mendapatkan notifikasi jika permintaan disetujui.'
        );
    } catch (error) {
        console.error('Error sending admin request:', error);
        await ctx.reply('❌ Gagal mengirim permintaan. Silakan coba lagi nanti.');
    }
});

// Handler untuk button accept_admin
bot.action(/accept_admin_(.+)/, adminMiddleware, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    
    // Tambahkan admin
    const added = db.addAdmin(userId);
    
    if (added) {
        await ctx.reply(`✅ Berhasil menambahkan admin dengan ID: ${userId}`);
        
        // Kirim notifikasi ke user
        try {
            await bot.telegram.sendMessage(
                userId,
                '🎉 *Selamat!*\n\n' +
                'Permintaan akses admin Anda telah disetujui.\n' +
                'Sekarang Anda dapat menggunakan bot ini dengan mengirim perintah /start.',
                {
                    parse_mode: 'Markdown'
                }
            );
        } catch (error) {
            console.error('Error sending notification:', error);
            await ctx.reply(`⚠️ Berhasil menambahkan admin, tetapi gagal mengirim notifikasi: ${error.message}`);
        }
    } else {
        await ctx.reply(`⚠️ User dengan ID ${userId} sudah menjadi admin.`);
    }
});

// Handler untuk button reject_admin
bot.action(/reject_admin_(.+)/, adminMiddleware, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.answerCbQuery();
    
    await ctx.reply(`✅ Berhasil menolak permintaan admin dari user ID: ${userId}`);
    
    // Kirim notifikasi ke user
    try {
        await bot.telegram.sendMessage(
            userId,
            '❌ *Permintaan Ditolak*\n\n' +
            'Maaf, permintaan akses admin Anda telah ditolak.',
            {
                parse_mode: 'Markdown'
            }
        );
    } catch (error) {
        console.error('Error sending notification:', error);
        await ctx.reply(`⚠️ Berhasil menolak permintaan, tetapi gagal mengirim notifikasi: ${error.message}`);
    }
});

// Mulai bot
bot.launch().then(() => {
    console.log('Bot started');
}).catch((err) => {
    console.error('Error starting bot:', err);
});

// Handle stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));