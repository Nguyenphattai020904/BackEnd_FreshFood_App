const express = require('express');
const db = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// Lấy danh sách voucher của user
router.get('/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const query = `
        SELECT * FROM vouchers 
        WHERE user_id = ? AND voucher_quantity > 0 AND voucher_date >= CURDATE()
    `;
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Áp dụng voucher
router.post('/apply', (req, res) => {
    const { voucher_id, order_total } = req.body;
    const query = `
        SELECT * FROM vouchers 
        WHERE voucher_id = ? AND voucher_quantity > 0 AND voucher_date >= CURDATE()
    `;
    db.query(query, [voucher_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Voucher không hợp lệ hoặc đã hết hạn' });

        const voucher = results[0];
        if (order_total < voucher.min_order_value) {
            return res.status(400).json({ error: `Đơn hàng phải từ ${voucher.min_order_value} VND để dùng voucher này` });
        }

        let discount = 0;
        if (voucher.voucher_type === 'percentage') {
            discount = order_total * (voucher.voucher_value / 100);
        } else if (voucher.voucher_type === 'fixed') {
            discount = voucher.voucher_value;
        }

        const updateQuery = 'UPDATE vouchers SET voucher_quantity = voucher_quantity - 1 WHERE voucher_id = ?';
        db.query(updateQuery, [voucher_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ discount, new_total: order_total - discount });
        });
    });
});

// Thêm voucher từ admin
router.post('/grant', verifyToken, (req, res) => {
    const { user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value } = req.body;

    const insertQuery = `
        INSERT INTO vouchers (user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `;
    db.query(insertQuery, [user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const voucherId = result.insertId;
        const receivedDate = new Date().toISOString().split("T")[0];
        const message = `Bạn đã nhận được voucher ${voucher_name}, ngày hết hạn: ${voucher_date}, nhận vào ngày: ${receivedDate}`;

        db.query(
            "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'voucher_received', ?, ?)",
            [user_id, message, voucherId],
            (err) => {
                if (err) console.log("❌ Error adding notification:", err.message);
            }
        );

        res.json({ success: true, message: "Voucher đã được cấp thành công", voucher_id: voucherId });
    });
});

// Lấy tất cả voucher (không cần xác thực)
router.get("/all", (req, res) => {
    console.log("📩 Request to /vouchers/all received at:", new Date().toISOString());
    console.log("Request headers:", req.headers);
    db.query(
        "SELECT * FROM vouchers",
        (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return res.status(500).json({ message: "Database error", error: err.message });
            }
            res.json({ vouchers: results });
        }
    );
});

// Lấy chi tiết voucher (không cần xác thực)
router.get("/:id", (req, res) => {
    const { id } = req.params;
    db.query(
        "SELECT * FROM vouchers WHERE voucher_id = ?",
        [id],
        (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return res.status(500).json({ message: "Database error", error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Voucher not found" });
            }
            res.json({ voucher: results[0] });
        }
    );
});

// Thêm voucher (không cần xác thực)
router.post("/create", (req, res) => {
    const { user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image } = req.body;

    if (!user_id || !voucher_name || !voucher_type || !voucher_value || !voucher_date || !min_order_value || !voucher_quantity) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo voucher" });
    }

    if (!['percentage', 'fixed'].includes(voucher_type)) {
        return res.status(400).json({ message: "Loại voucher không hợp lệ, phải là 'percentage' hoặc 'fixed'" });
    }

    db.query(
        "INSERT INTO vouchers (user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image],
        (err, results) => {
            if (err) {
                console.error("❌ Error adding voucher:", err);
                return res.status(500).json({ message: "Error adding voucher", error: err.message });
            }
            res.json({ message: "Voucher added successfully", voucherId: results.insertId });
        }
    );
});

// Sửa voucher (không cần xác thực)
router.put("/update/:id", (req, res) => {
    const { id } = req.params;
    const { user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image } = req.body;

    if (!user_id || !voucher_name || !voucher_type || !voucher_value || !voucher_date || !min_order_value || !voucher_quantity) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để cập nhật voucher" });
    }

    if (!['percentage', 'fixed'].includes(voucher_type)) {
        return res.status(400).json({ message: "Loại voucher không hợp lệ, phải là 'percentage' hoặc 'fixed'" });
    }

    db.query(
        "UPDATE vouchers SET user_id = ?, voucher_name = ?, voucher_type = ?, voucher_value = ?, voucher_date = ?, min_order_value = ?, voucher_quantity = ?, voucher_image = ? WHERE voucher_id = ?",
        [user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image, id],
        (err, results) => {
            if (err) {
                console.error("❌ Error updating voucher:", err);
                return res.status(500).json({ message: "Error updating voucher", error: err.message });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ message: "Voucher not found" });
            }
            res.json({ message: "Voucher updated successfully" });
        }
    );
});

// Xóa voucher (không cần xác thực)
router.delete("/delete/:id", (req, res) => {
    const { id } = req.params;

    // Kiểm tra xem voucher có đang được sử dụng trong đơn hàng không
    db.query(
        "SELECT * FROM orders WHERE voucher_id = ?",
        [id],
        (err, results) => {
            if (err) {
                console.error("❌ Error checking orders:", err);
                return res.status(500).json({ message: "Error checking orders", error: err.message });
            }
            if (results.length > 0) {
                return res.status(400).json({ message: "Không thể xóa voucher vì đang được sử dụng trong đơn hàng" });
            }

            db.query(
                "DELETE FROM vouchers WHERE voucher_id = ?",
                [id],
                (err, results) => {
                    if (err) {
                        console.error("❌ Error deleting voucher:", err);
                        return res.status(500).json({ message: "Error deleting voucher", error: err.message });
                    }
                    if (results.affectedRows === 0) {
                        return res.status(404).json({ message: "Voucher not found" });
                    }
                    res.json({ message: "Voucher deleted successfully" });
                }
            );
        }
    );
});

module.exports = router;