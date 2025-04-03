const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/sales-stats', (req, res) => {
    console.log("📩 Request to /dashboard/sales-stats received at:", new Date().toISOString());
    console.log("Request headers:", req.headers);

    const date = req.query.date || '2025-04-03'; // Mặc định là 3/4/2025
    console.log("📅 Date parameter:", date);

    const query = `
        SELECT 
            DATE(o.created_at) as sale_date,
            SUM(o.total_price) as total_revenue,
            SUM(oi.quantity) as total_quantity
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE DATE(o.created_at) = ?
        GROUP BY DATE(o.created_at)
        ORDER BY sale_date ASC
    `;

    db.query(query, [date], (err, results) => {
        if (err) {
            console.error("❌ Database error:", err);
            return res.status(500).json({ message: "Database error", error: err.message });
        }

        // Nếu không có dữ liệu, trả về mảng rỗng
        const stats = results.length > 0 
            ? results.map(row => ({
                date: row.sale_date.toISOString().split('T')[0],
                totalRevenue: row.total_revenue || 0,
                totalQuantity: row.total_quantity || 0
            }))
            : [];

        console.log("📊 Sales stats response:", stats);
        res.json({ salesStats: stats });
    });
});

module.exports = router;