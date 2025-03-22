const express = require("express");
const connection = require("../db");
const { createZaloPayOrder } = require("../utils/zalopay");

const router = express.Router();

// API lấy danh sách sản phẩm
router.get("/products", (req, res) => {
    connection.query("SELECT * FROM products", (err, results) => {
        if (err) {
            console.log("❌ Database error:", err.sqlMessage);
            return res.status(500).json({ message: "Lỗi database", error: err.sqlMessage });
        }
        res.json({ products: results });
    });
});

// API kiểm tra trạng thái đơn hàng
router.get("/order-status/:orderId", (req, res) => {
    const { orderId } = req.params;

    connection.query(
        "SELECT payment_status FROM orders WHERE id = ?", // Sửa order_id thành id
        [orderId],
        (err, results) => {
            if (err) {
                return res.status(500).json({ message: "Database error", error: err });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Order not found" });
            }
            res.json({ payment_status: results[0].payment_status });
        }
    );
});

// API tạo đơn hàng
router.post("/create", (req, res) => {
    const { user_id, items, payment_method, name, phone, address } = req.body;

    if (!user_id || !items || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Missing fields" });
    }

    const productIds = items.map(item => item.product_id);

    // Bắt đầu transaction
    connection.beginTransaction((err) => {
        if (err) return res.status(500).json({ message: "Transaction error", error: err });

        // 1. Lấy giá, số lượng và ảnh sản phẩm từ database
        connection.query(
            "SELECT product_id, name, price, quantity, images FROM products WHERE product_id IN (?)",
            [productIds],
            (err, results) => {
                if (err) {
                    return connection.rollback(() => {
                        res.status(500).json({ message: "Failed to get product info", error: err });
                    });
                }

                // Tạo map product_id -> thông tin sản phẩm
                const productMap = {};
                results.forEach(prod => {
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
                            message: "Invalid products detected", 
                            invalid_products: invalidItems 
                        });
                    });
                }

                // Kiểm tra số lượng tồn kho
                for (const item of items) {
                    if (item.quantity > productMap[item.product_id].quantity) {
                        return connection.rollback(() => {
                            res.status(400).json({ 
                                message: `Not enough stock for product ${productMap[item.product_id].name}`, 
                                product_id: item.product_id 
                            });
                        });
                    }
                }

                // 2. Tính tổng tiền từ database
                let total_price = 0;
                const orderItemsValues = items.map(item => {
                    const productInfo = productMap[item.product_id];
                    const itemTotalPrice = item.quantity * productInfo.price;
                    total_price += itemTotalPrice;
                    return [productInfo.name, item.product_id, item.quantity, itemTotalPrice, productInfo.image];
                });

                // 3. Thêm order vào bảng `orders`
                connection.query(
                    "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
                    [user_id, total_price, payment_method, name, phone, address, payment_method === "COD" ? "pending" : "unpaid"],
                    (err, orderResult) => {
                        if (err) {
                            return connection.rollback(() => {
                                res.status(500).json({ message: "Failed to create order", error: err });
                            });
                        }
                        const orderId = orderResult.insertId;

                        // 4. Thêm order items vào `order_items`
                        const orderItemsQuery = "INSERT INTO order_items (order_id, product_id, quantity, price, image) VALUES ?";
                        const orderItemsWithOrderId = orderItemsValues.map(item => [orderId, item[1], item[2], item[3], item[4]]);

                        connection.query(orderItemsQuery, [orderItemsWithOrderId], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    res.status(500).json({ message: "Failed to add order items", error: err });
                                });
                            }

                            // 5. Trừ số lượng tồn kho
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

                            Promise.all(updateStockQueries)
                                .then(async () => {
                                    // Nếu thanh toán bằng ZaloPay thì tạo đơn hàng trên ZaloPay
                                    if (payment_method === "ZaloPay") {
                                        const zaloPayResponse = await createZaloPayOrder(total_price, orderId);

                                        if (zaloPayResponse.return_code === 1) {
                                            // Cập nhật trạng thái đơn hàng là "waiting_payment"
                                            connection.query(
                                                "UPDATE orders SET payment_status = 'waiting_payment' WHERE id = ?", // Sửa order_id thành id
                                                [orderId],
                                                (err) => {
                                                    if (err) {
                                                        return connection.rollback(() => {
                                                            res.status(500).json({ message: "Failed to update payment status", error: err });
                                                        });
                                                    }
                                                    // Commit transaction
                                                    connection.commit((err) => {
                                                        if (err) {
                                                            return connection.rollback(() => {
                                                                res.status(500).json({ message: "Transaction commit error", error: err });
                                                            });
                                                        }
                                                        res.json({
                                                            message: "Order placed successfully",
                                                            orderId,
                                                            total_price,
                                                            zaloPay_url: zaloPayResponse.order_url,
                                                        });
                                                    });
                                                }
                                            );
                                        } else {
                                            return connection.rollback(() => {
                                                res.status(500).json({
                                                    message: "Failed to create order on ZaloPay",
                                                    zaloPayResponse,
                                                });
                                            });
                                        }
                                    } else {
                                        // Commit transaction nếu là COD
                                        connection.commit((err) => {
                                            if (err) {
                                                return connection.rollback(() => {
                                                    res.status(500).json({ message: "Transaction commit error", error: err });
                                                });
                                            }
                                            res.json({ message: "Order placed successfully", orderId, total_price });
                                        });
                                    }
                                })
                                .catch((err) => {
                                    return connection.rollback(() => {
                                        res.status(500).json({ message: "Failed to update stock", error: err });
                                    });
                                });
                        });
                    }
                );
            }
        );
    });
});

module.exports = router;