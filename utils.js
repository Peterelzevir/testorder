// utils.js
const fs = require('fs');
const path = require('path');

// Ekstrak angka dari string
function extractNumber(str) {
    const matches = str.match(/\d+/g);
    return matches ? matches.map(Number) : [];
}

// Fungsi untuk increment angka pada nama
function incrementGroupName(name) {
    // Cari angka dalam string
    const matches = name.match(/(\d+)/g);
    
    if (!matches || matches.length === 0) {
        // Jika tidak ada angka, tambahkan angka 1
        return `${name} 1`;
    }
    
    // Ambil angka terakhir
    const lastNumber = matches[matches.length - 1];
    const lastNumberIndex = name.lastIndexOf(lastNumber);
    const prefix = name.substring(0, lastNumberIndex);
    const suffix = name.substring(lastNumberIndex + lastNumber.length);
    
    // Parse angka jadi integer
    let number = parseInt(lastNumber, 10);
    
    // Increment angka
    number++;
    
    // Format angka dengan leading zero jika ada
    let newNumber = number.toString();
    if (lastNumber.startsWith('0')) {
        // Pertahankan jumlah digit yang sama dengan leading zero
        const digitCount = lastNumber.length;
        newNumber = newNumber.padStart(digitCount, '0');
    }
    
    // Gabungkan kembali
    return prefix + newNumber + suffix;
}

// Buat file text
function createTextFile(content, fileName) {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filePath = path.join(tempDir, fileName);
        fs.writeFile(filePath, content, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(filePath);
        });
    });
}

// Fungsi untuk memisahkan array menjadi chunks
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Fungsi untuk format nomor telepon
function formatPhoneNumber(number) {
    let phoneNumber = number.trim();
    
    // Hapus semua karakter non-digit
    phoneNumber = phoneNumber.replace(/\D/g, '');
    
    // Hapus + atau 0 di awal jika ada
    if (phoneNumber.startsWith('+')) {
        phoneNumber = phoneNumber.substring(1);
    }
    if (phoneNumber.startsWith('0')) {
        phoneNumber = '62' + phoneNumber.substring(1);
    }
    
    // Pastikan diawali dengan kode negara Indonesia jika belum
    if (!phoneNumber.startsWith('62')) {
        phoneNumber = '62' + phoneNumber;
    }
    
    return phoneNumber;
}

module.exports = {
    extractNumber,
    incrementGroupName,
    createTextFile,
    chunkArray,
    formatPhoneNumber
};