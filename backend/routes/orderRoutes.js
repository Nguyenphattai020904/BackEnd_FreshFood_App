const express = require('express');
const db = require('../db');
const router = express.Router();

// Lấy danh sách đơn hàng
router.get('/', (req, res) => {
    console.log("📩 Request to /order received at:", new Date().toISOString());
    console.log("Request headers:", req.headers);

    const query = `
        SELECT id as orderId, total_price as totalPrice, created_at as orderDate
        FROM orders
        ORDER BY created_at DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("❌ Database error:", err);
            return res.status(500).json({ message: "Database error", error: err.message });
        }
        res.json({ orders: results });
    });
});

// Lấy chi tiết đơn hàng
router.get('/detail/:orderId', (req, res) => {
    const { orderId } = req.params;
    console.log(`📩 Request to /order/detail/${orderId} received at:`, new Date().toISOString());
    console.log("Request headers:", req.headers);

    if (isNaN(orderId)) {
        return res.status(400).json({ message: "orderId phải là số" });
    }

    // Sử dụng cột 'order_id' thay vì 'orderId'
    const query = `
        SELECT oi.product_id, oi.quantity, oi.price
        FROM order_items oi
        WHERE oi.order_id = ?
    `;

    db.query(query, [orderId], (err, results) => {
        if (err) {
            console.error("❌ Database error:", err);
            return res.status(500).json({ message: "Database error", error: err.message });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy chi tiết đơn hàng" });
        }
        res.json({ order: { items: results } });
    });
});

module.exports = router;