const db = require('./db');

async function testConnection() {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        console.log('Kết nối thành công:', rows);
    } catch (err) {
        console.error('Lỗi kết nối:', err);
    }
}

testConnection();
