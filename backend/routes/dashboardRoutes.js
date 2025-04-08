const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/sales-stats', (req, res) => {
    const requestId = req.query.requestId || 'unknown';
    console.log(`📩 Yêu cầu đến /dashboard/sales-stats nhận được lúc: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}, Request ID: ${requestId}`);

    const query = `
        WITH RECURSIVE date_range AS (
            SELECT DATE(MIN(created_at)) AS sale_date
            FROM orders
            UNION ALL
            SELECT DATE_ADD(sale_date, INTERVAL 1 DAY)
            FROM date_range
            WHERE sale_date < DATE(NOW())
        )
        SELECT 
            dr.sale_date,
            COALESCE(SUM(o.total_price), 0) AS total_revenue,
            COALESCE((
                SELECT SUM(oi.quantity)
                FROM order_items oi
                JOIN orders o2 ON oi.order_id = o2.id
                WHERE DATE(o2.created_at) = dr.sale_date
            ), 0) AS total_quantity
        FROM date_range dr
        LEFT JOIN orders o ON DATE(o.created_at) = dr.sale_date
        GROUP BY dr.sale_date
        ORDER BY dr.sale_date ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error(`❌ Lỗi cơ sở dữ liệu cho Request ID ${requestId}:`, err);
            return res.status(500).json({ message: "Lỗi cơ sở dữ liệu", error: err.message });
        }

        console.log(`📊 Kết quả truy vấn thô cho Request ID ${requestId}:`, results);

        const stats = results.map(row => ({
            date: row.sale_date.toISOString().split('T')[0],
            totalRevenue: Number(row.total_revenue) || 0,
            totalQuantity: Number(row.total_quantity) || 0
        }));

        console.log(`📊 Phản hồi thống kê doanh thu cho Request ID ${requestId}:`, stats);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.json({ salesStats: stats });
    });
});

module.exports = router;