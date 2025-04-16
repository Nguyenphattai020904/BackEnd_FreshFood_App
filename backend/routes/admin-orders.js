const express = require("express");
const connection = require("../db");
const { formatStatus } = require("./order");

const router = express.Router();

// API lấy tất cả đơn hàng
router.get("/all", (req, res) => {
    console.log("📩 Request to /admin-orders/all received at:", new Date().toISOString());
    connection.query(
        "SELECT * FROM orders",
        (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return res.status(500).json({ message: "Lỗi database", error: err.message });
            }
            console.log(`✅ Fetched ${results.length} orders`);
            res.json({ orders: results });
        }
    );
});

// API thêm đơn hàng
router.post("/create-admin", (req, res) => {
    const { user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id } = req.body;

    if (!user_id || !total_price || !status || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo đơn hàng" });
    }

    const validStatuses = ["pending", "confirmed", "packing", "shipping", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Trạng thái không hợp lệ. Các trạng thái cho phép: " + validStatuses.join(", ") });
    }

    connection.query(
        "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, total_price, status, payment_method, name, phone, address, payment_status || "unpaid", created_at || null, voucher_id || null, app_trans_id || null],
        (err, result) => {
            if (err) {
                console.error("❌ Error adding order:", err);
                return res.status(500).json({ message: "Lỗi thêm đơn hàng", error: err.message });
            }
            res.json({ message: "Thêm đơn hàng thành công", orderId: result.insertId });
        }
    );
});

// API cập nhật đơn hàng
router.put("/:orderId", (req, res) => {
    const { orderId } = req.params;
    const { user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id } = req.body;

    if (!user_id || !total_price || !status || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để cập nhật đơn hàng" });
    }

    const validStatuses = ["pending", "confirmed", "packing", "shipping", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Trạng thái không hợp lệ. Các trạng thái cho phép: " + validStatuses.join(", ") });
    }

    connection.query(
        "SELECT status, user_id FROM orders WHERE id = ?",
        [orderId],
        (err, results) => {
            if (err) {
                console.error("❌ Error fetching current order status:", err);
                return res.status(500).json({ message: "Lỗi database", error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Đơn hàng không tồn tại" });
            }

            const currentStatus = results[0].status;
            const orderUserId = results[0].user_id;

            connection.query(
                "UPDATE orders SET user_id = ?, total_price = ?, status = ?, payment_method = ?, name = ?, phone = ?, address = ?, payment_status = ?, created_at = ?, voucher_id = ?, app_trans_id = ? WHERE id = ?",
                [user_id, total_price, status, payment_method, name, phone, address, payment_status || "unpaid", created_at || null, voucher_id || null, app_trans_id || null, orderId],
                (err, results) => {
                    if (err) {
                        console.error("❌ Error updating order:", err);
                        return res.status(500).json({ message: "Lỗi cập nhật đơn hàng", error: err.message });
                    }
                    if (results.affectedRows === 0) {
                        return res.status(404).json({ message: "Đơn hàng không tồn tại" });
                    }

                    if (currentStatus !== status) {
                        const formattedStatus = formatStatus(status);
                        const notificationMessage = `Mã đơn hàng: ${orderId}. Đơn hàng của bạn đang ${formattedStatus}.`;

                        connection.query(
                            "INSERT INTO notifications (user_id, type, message, related_id, created_at) VALUES (?, 'order_update', ?, ?, NOW())",
                            [orderUserId, notificationMessage, orderId],
                            (err) => {
                                if (err) {
                                    console.error("❌ Error adding notification:", err);
                                } else {
                                    console.log(`✅ Notification sent for order ${orderId}: ${notificationMessage}`);
                                }
                            }
                        );
                    }

                    res.json({ message: "Cập nhật đơn hàng thành công" });
                }
            );
        }
    );
});

// API cập nhật trạng thái đơn hàng
router.patch("/update-status/:orderId", (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ["pending", "confirmed", "packing", "shipping", "delivered", "cancelled"];
    if (!status || !validStatuses.includes(status)) {
        console.log(`❌ Invalid status for order ${orderId}: ${status}`);
        return res.status(400).json({ message: "Trạng thái không hợp lệ. Các trạng thái cho phép: " + validStatuses.join(", ") });
    }

    console.log(`📩 Request to update status for order ${orderId} to ${status} at:`, new Date().toISOString());

    connection.query(
        "SELECT status, user_id FROM orders WHERE id = ?",
        [orderId],
        (err, results) => {
            if (err) {
                console.error("❌ Error fetching current order status:", err);
                return res.status(500).json({ message: "Lỗi database", error: err.message });
            }
            if (results.length === 0) {
                console.log(`❌ Order ${orderId} not found`);
                return res.status(404).json({ message: "Đơn hàng không tồn tại" });
            }

            const currentStatus = results[0].status;
            const orderUserId = results[0].user_id;

            if (currentStatus === status) {
                console.log(`⚠️ Status for order ${orderId} unchanged: ${status}`);
                return res.status(200).json({ message: "Trạng thái không thay đổi", currentStatus });
            }

            connection.query(
                "UPDATE orders SET status = ? WHERE id = ?",
                [status, orderId],
                (err, results) => {
                    if (err) {
                        console.error("❌ Error updating order status:", err);
                        return res.status(500).json({ message: "Lỗi cập nhật trạng thái", error: err.message });
                    }
                    if (results.affectedRows === 0) {
                        console.log(`❌ Order ${orderId} not found during update`);
                        return res.status(404).json({ message: "Đơn hàng không tồn tại" });
                    }

                    console.log(`✅ Order ${orderId} status updated to ${status}`);

                    const formattedStatus = formatStatus(status);
                    const notificationMessage = `Mã đơn hàng: ${orderId}. Đơn hàng của bạn đang ${formattedStatus}.`;

                    connection.query(
                        "INSERT INTO notifications (user_id, type, message, related_id, created_at) VALUES (?, 'order_update', ?, ?, NOW())",
                        [orderUserId, notificationMessage, orderId],
                        (err) => {
                            if (err) {
                                console.error("❌ Error adding notification:", err);
                            } else {
                                console.log(`✅ Notification sent for order ${orderId}: ${notificationMessage}`);
                            }
                        }
                    );

                    res.json({ message: "Cập nhật trạng thái đơn hàng thành công", status });
                }
            );
        }
    );
});

// API xóa đơn hàng
router.delete("/:orderId", (req, res) => {
    const { orderId } = req.params;

    console.log(`📩 Request to delete order ${orderId} received at:`, new Date().toISOString());

    connection.query(
        "SELECT user_id, status FROM orders WHERE id = ?",
        [orderId],
        (err, results) => {
            if (err) {
                console.error("❌ Error fetching order:", err);
                return res.status(500).json({ message: "Lỗi database", error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Đơn hàng không tồn tại" });
            }

            const orderUserId = results[0].user_id;
            const orderStatus = results[0].status;

            if (["delivered", "cancelled"].includes(orderStatus)) {
                return res.status(400).json({ message: "Không thể xóa đơn hàng đã giao hoặc đã hủy" });
            }

            connection.query(
                "DELETE FROM order_items WHERE order_id = ?",
                [orderId],
                (err) => {
                    if (err) {
                        console.error("❌ Error deleting order items:", err);
                        return res.status(500).json({ message: "Lỗi xóa mục đơn hàng", error: err.message });
                    }

                    connection.query(
                        "DELETE FROM orders WHERE id = ?",
                        [orderId],
                        (err, results) => {
                            if (err) {
                                console.error("❌ Error deleting order:", err);
                                return res.status(500).json({ message: "Lỗi xóa đơn hàng", error: err.message });
                            }
                            if (results.affectedRows === 0) {
                                return res.status(404).json({ message: "Đơn hàng không tồn tại" });
                            }

                            const notificationMessage = `Mã đơn hàng: ${orderId} đã bị hủy bởi admin.`;
                            connection.query(
                                "INSERT INTO notifications (user_id, type, message, related_id, created_at) VALUES (?, 'order_cancelled', ?, ?, NOW())",
                                [orderUserId, notificationMessage, orderId],
                                (err) => {
                                    if (err) {
                                        console.error("❌ Error adding notification:", err);
                                    } else {
                                        console.log(`✅ Notification sent for order ${orderId}: ${notificationMessage}`);
                                    }
                                }
                            );

                            res.json({ message: "Xóa đơn hàng thành công" });
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;