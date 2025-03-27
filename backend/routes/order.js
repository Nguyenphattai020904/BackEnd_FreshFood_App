const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");
const { createZaloPayOrder } = require("../utils/zalopay");

const router = express.Router();

// API lấy danh sách sản phẩm
router.get("/products", (req, res) => {
    connection.query("SELECT * FROM products", (err, results) => {
        if (err) {
            console.log("❌ Database error:", err.message || err);
            return res.status(500).json({ message: "Lỗi database", error: err.message || err });
        }
        res.json({ products: results });
    });
});

// API kiểm tra trạng thái đơn hàng
router.get("/order-status/:orderId", (req, res) => {
    const { orderId } = req.params;

    connection.query(
        "SELECT payment_status FROM orders WHERE id = ?",
        [orderId],
        (err, results) => {
            if (err) {
                console.log("❌ Database error:", err.message || err);
                return res.status(500).json({ message: "Lỗi database", error: err.message || err });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Đơn hàng không tồn tại" });
            }
            res.json({ payment_status: results[0].payment_status });
        }
    );
});

// API tạo đơn hàng
router.post("/create", verifyToken, async (req, res) => {
    const { items, total_price, payment_method, name, phone, address } = req.body;
    const userId = req.user.id; // Lấy userId từ token (đã được xác thực qua middleware)

    // Kiểm tra các trường bắt buộc
    if (!items || !total_price || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo đơn hàng" });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Danh sách sản phẩm không hợp lệ" });
    }

    const productIds = items.map(item => item.product_id);

    try {
        // Bắt đầu transaction
        connection.beginTransaction(async (err) => {
            if (err) {
                console.log("❌ Transaction error:", err.message || err);
                return res.status(500).json({ message: "Lỗi giao dịch", error: err.message || err });
            }

            try {
                // 1. Kiểm tra xem userId có tồn tại trong bảng users không
                const userCheck = await new Promise((resolve, reject) => {
                    connection.query(
                        "SELECT id FROM users WHERE id = ?",
                        [userId],
                        (err, results) => {
                            if (err) reject(err);
                            else resolve(results);
                        }
                    );
                });

                if (!userCheck || userCheck.length === 0) {
                    return connection.rollback(() => {
                        res.status(400).json({ message: "Người dùng không tồn tại. Vui lòng kiểm tra userId." });
                    });
                }

                // 2. Lấy thông tin sản phẩm từ database
                const products = await new Promise((resolve, reject) => {
                    connection.query(
                        "SELECT product_id, name, price, quantity, images FROM products WHERE product_id IN (?)",
                        [productIds],
                        (err, results) => {
                            if (err) reject(err);
                            else resolve(results);
                        }
                    );
                });

                // Tạo map product_id -> thông tin sản phẩm
                const productMap = {};
                products.forEach(prod => {
                    let imageUrl = null;
                    try {
                        const imagesArray = JSON.parse(prod.images);
                        imageUrl = imagesArray.length > 0 ? imagesArray[0] : null;
                    } catch (error) {
                        imageUrl = null;
                    }

                    productMap[prod.product_id] = {
                        name: prod.name,
                        price: prod.price,
                        quantity: prod.quantity,
                        image: imageUrl
                    };
                });

                // Kiểm tra sản phẩm hợp lệ
                const invalidItems = items.filter(item => !productMap[item.product_id]);
                if (invalidItems.length > 0) {
                    return connection.rollback(() => {
                        res.status(400).json({ 
                            message: "Phát hiện sản phẩm không hợp lệ", 
                            invalid_products: invalidItems 
                        });
                    });
                }

                // Kiểm tra số lượng tồn kho
                for (const item of items) {
                    if (item.quantity > productMap[item.product_id].quantity) {
                        return connection.rollback(() => {
                            res.status(400).json({ 
                                message: `Không đủ hàng trong kho cho sản phẩm ${productMap[item.product_id].name}`, 
                                product_id: item.product_id 
                            });
                        });
                    }
                }

                // 3. Kiểm tra total_price từ client với giá tính toán từ server
                let calculatedTotalPrice = 0;
                const orderItemsValues = items.map(item => {
                    const productInfo = productMap[item.product_id];
                    const itemTotalPrice = item.quantity * productInfo.price;
                    calculatedTotalPrice += itemTotalPrice;
                    return [productInfo.name, item.product_id, item.quantity, itemTotalPrice, productInfo.image];
                });

                calculatedTotalPrice = Number(calculatedTotalPrice.toFixed(2));
                const clientTotalPrice = Number(total_price.toFixed(2));
                if (calculatedTotalPrice !== clientTotalPrice) {
                    return connection.rollback(() => {
                        res.status(400).json({ 
                            message: "Tổng giá trị đơn hàng không khớp. Client: " + clientTotalPrice + ", Server: " + calculatedTotalPrice
                        });
                    });
                }

                // 4. Thêm order vào bảng `orders`
                const orderResult = await new Promise((resolve, reject) => {
                    connection.query(
                        "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
                        [userId, calculatedTotalPrice, payment_method, name, phone, address, payment_method === "COD" ? "pending" : "unpaid"],
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });

                const orderId = orderResult.insertId;

                // 5. Thêm order items vào `order_items`
                const orderItemsQuery = "INSERT INTO order_items (order_id, product_id, quantity, price, image) VALUES ?";
                const orderItemsWithOrderId = orderItemsValues.map(item => [orderId, item[1], item[2], item[3], item[4]]);
                await new Promise((resolve, reject) => {
                    connection.query(orderItemsQuery, [orderItemsWithOrderId], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                // 6. Trừ số lượng tồn kho
                const updateStockQueries = items.map(item => {
                    return new Promise((resolve, reject) => {
                        connection.query(
                            "UPDATE products SET quantity = quantity - ? WHERE product_id = ?",
                            [item.quantity, item.product_id],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                });

                await Promise.all(updateStockQueries);

                // 7. Xử lý thanh toán ZaloPay nếu có
                if (payment_method === "ZaloPay") {
                    const zaloPayResponse = await createZaloPayOrder(calculatedTotalPrice, orderId);

                    if (zaloPayResponse.return_code === 1) {
                        // Cập nhật trạng thái đơn hàng là "waiting_payment"
                        await new Promise((resolve, reject) => {
                            connection.query(
                                "UPDATE orders SET payment_status = 'waiting_payment' WHERE id = ?",
                                [orderId],
                                (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        });

                        // Commit transaction
                        await new Promise((resolve, reject) => {
                            connection.commit((err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });

                        res.json({
                            message: "Đơn hàng đã được tạo thành công",
                            orderId,
                            total_price: calculatedTotalPrice,
                            zaloPay_url: zaloPayResponse.order_url,
                        });
                    } else {
                        // Nếu ZaloPay thất bại, rollback và trả về lỗi
                        await new Promise((resolve) => {
                            connection.rollback(resolve);
                        });
                        res.status(500).json({
                            message: "Không thể tạo đơn hàng trên ZaloPay",
                            zaloPayResponse,
                        });
                    }
                } else {
                    // Nếu là COD, commit transaction
                    await new Promise((resolve, reject) => {
                        connection.commit((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    res.json({
                        message: "Đơn hàng đã được tạo thành công",
                        orderId,
                        total_price: calculatedTotalPrice,
                    });
                }
            } catch (error) {
                console.log("❌ Transaction error:", error.message || error);
                await new Promise((resolve) => {
                    connection.rollback(resolve);
                });
                res.status(500).json({ message: "Lỗi trong quá trình xử lý đơn hàng", error: error.message || error });
            }
        });
    } catch (error) {
        console.log("❌ Server error:", error.message || error);
        res.status(500).json({ message: "Lỗi server", error: error.message || error });
    }
});

module.exports = router;