const express = require('express');
const connection = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();

// Lấy danh sách thông báo
router.get('/:userId', verifyToken, (req, res) => {
    const { userId } = req.params;
    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    connection.query(
        "SELECT id, type, message, is_read, created_at, related_id FROM notifications WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Lỗi database", error: err.message });

            // Đánh dấu tất cả là đã đọc
            connection.query(
                "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
                [userId],
                (err) => {
                    if (err) console.log("❌ Error updating read status:", err.message);
                }
            );

            res.json({
                success: true,
                notifications: results.map(notif => ({
                    id: notif.id,
                    type: notif.type,
                    message: notif.message,
                    isRead: notif.is_read === 1,
                    createdAt: notif.created_at.toISOString(),
                    relatedId: notif.related_id
                }))
            });
        }
    );
});

// Đếm số thông báo chưa đọc
router.get('/unread-count/:userId', verifyToken, (req, res) => {
    const { userId } = req.params;
    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    connection.query(
        "SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = 0",
        [userId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Lỗi database", error: err.message });
            res.json({ unreadCount: results[0].unreadCount });
        }
    );
});

// Xóa thông báo
router.delete('/:id', verifyToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    connection.query(
        "DELETE FROM notifications WHERE id = ? AND user_id = ?",
        [id, userId],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Lỗi database", error: err.message });
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Thông báo không tồn tại hoặc không thuộc về bạn" });
            }
            res.json({ success: true, message: "Xóa thông báo thành công" });
        }
    );
});

module.exports = router;