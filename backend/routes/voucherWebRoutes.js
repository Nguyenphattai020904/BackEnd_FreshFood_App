const express = require('express');
const db = require('../db');
const router = express.Router();

// Lấy tất cả voucher (dành cho web)
router.get("/all", (req, res) => {
    console.log("📩 Request to /vouchers/web/all received at:", new Date().toISOString());
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

// Lấy chi tiết voucher (dành cho web)
router.get("/:id", (req, res) => {
    const { id } = req.params;
    console.log(`📩 Request to /vouchers/web/${id} received at:`, new Date().toISOString());
    console.log("Request headers:", req.headers);
    if (isNaN(id)) {
        console.log(`❌ Invalid voucher_id: ${id} is not a number`);
        return res.status(400).json({ message: "voucher_id phải là số" });
    }
    db.query(
        "SELECT * FROM vouchers WHERE voucher_id = ?",
        [id],
        (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return res.status(500).json({ message: "Database error", error: err.message });
            }
            if (results.length === 0) {
                console.log(`❌ Voucher with ID ${id} not found`);
                return res.status(404).json({ message: "Voucher not found" });
            }
            console.log(`✅ Voucher with ID ${id} found:`, results[0]);
            res.json({ voucher: results[0] });
        }
    );
});

// Thêm voucher (dành cho web)
router.post("/create", (req, res) => {
    const { user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image } = req.body;

    // Kiểm tra các trường bắt buộc
    if (!user_id || !voucher_name || !voucher_type || !voucher_value || !voucher_date || !min_order_value || !voucher_quantity) {
        const missingFields = [];
        if (!user_id) missingFields.push("user_id");
        if (!voucher_name) missingFields.push("voucher_name");
        if (!voucher_type) missingFields.push("voucher_type");
        if (!voucher_value) missingFields.push("voucher_value");
        if (!voucher_date) missingFields.push("voucher_date");
        if (!min_order_value) missingFields.push("min_order_value");
        if (!voucher_quantity) missingFields.push("voucher_quantity");
        return res.status(400).json({ message: `Thiếu các trường bắt buộc: ${missingFields.join(", ")}` });
    }

    if (isNaN(user_id) || user_id <= 0) {
        return res.status(400).json({ message: "user_id phải là số nguyên dương" });
    }
    if (isNaN(voucher_value) || voucher_value <= 0) {
        return res.status(400).json({ message: "voucher_value phải là số dương" });
    }
    if (isNaN(min_order_value) || min_order_value <= 0) {
        return res.status(400).json({ message: "min_order_value phải là số dương" });
    }
    if (isNaN(voucher_quantity) || voucher_quantity <= 0) {
        return res.status(400).json({ message: "voucher_quantity phải là số nguyên dương" });
    }
    if (!['percentage', 'fixed'].includes(voucher_type)) {
        return res.status(400).json({ message: "Loại voucher không hợp lệ, phải là 'percentage' hoặc 'fixed'" });
    }

    db.query(
        "INSERT INTO vouchers (user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image || null],
        (err, results) => {
            if (err) {
                console.error("❌ Error adding voucher:", err);
                return res.status(500).json({ message: "Error adding voucher", error: err.message });
            }
            res.json({ message: "Voucher added successfully", voucherId: results.insertId });
        }
    );
});

// Sửa voucher (dành cho web)
router.put("/update/:id", (req, res) => {
    const { id } = req.params;
    const { user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image } = req.body;

    if (!user_id || !voucher_name || !voucher_type || !voucher_value || !voucher_date || !min_order_value || !voucher_quantity) {
        const missingFields = [];
        if (!user_id) missingFields.push("user_id");
        if (!voucher_name) missingFields.push("voucher_name");
        if (!voucher_type) missingFields.push("voucher_type");
        if (!voucher_value) missingFields.push("voucher_value");
        if (!voucher_date) missingFields.push("voucher_date");
        if (!min_order_value) missingFields.push("min_order_value");
        if (!voucher_quantity) missingFields.push("voucher_quantity");
        return res.status(400).json({ message: `Thiếu các trường bắt buộc: ${missingFields.join(", ")}` });
    }

    if (isNaN(user_id) || user_id <= 0) {
        return res.status(400).json({ message: "user_id phải là số nguyên dương" });
    }
    if (isNaN(voucher_value) || voucher_value <= 0) {
        return res.status(400).json({ message: "voucher_value phải là số dương" });
    }
    if (isNaN(min_order_value) || min_order_value <= 0) {
        return res.status(400).json({ message: "min_order_value phải là số dương" });
    }
    if (isNaN(voucher_quantity) || voucher_quantity <= 0) {
        return res.status(400).json({ message: "voucher_quantity phải là số nguyên dương" });
    }
    if (!['percentage', 'fixed'].includes(voucher_type)) {
        return res.status(400).json({ message: "Loại voucher không hợp lệ, phải là 'percentage' hoặc 'fixed'" });
    }

    db.query(
        "UPDATE vouchers SET user_id = ?, voucher_name = ?, voucher_type = ?, voucher_value = ?, voucher_date = ?, min_order_value = ?, voucher_quantity = ?, voucher_image = ? WHERE voucher_id = ?",
        [user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image || null, id],
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

// Xóa voucher (dành cho web)
router.delete("/delete/:id", (req, res) => {
    const { id } = req.params;

    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "voucher_id phải là số nguyên dương" });
    }

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