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

// API lấy danh sách đơn hàng của người dùng
router.get("/:userId", verifyToken, (req, res) => {
    const { userId } = req.params;

    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    connection.query(
        `SELECT o.id AS orderId, o.created_at AS orderDate, o.total_price AS totalPrice,
                (SELECT oi.image FROM order_items oi WHERE oi.order_id = o.id LIMIT 1) AS firstProductImage
                FROM orders o
                WHERE o.user_id = ?
                ORDER BY o.created_at DESC`,
        [userId],
        (err, results) => {
            if (err) {
                console.log("❌ Database error:", err.message || err);
                return res.status(500).json({ message: "Lỗi database", error: err.message || err });
            }

            res.json({
                success: true,
                message: "Lấy danh sách đơn hàng thành công",
                orders: results.map(order => ({
                    orderId: order.orderId.toString(),
                    orderDate: order.orderDate ? order.orderDate.toISOString().split("T")[0] : null,
                    totalPrice: order.totalPrice,
                    firstProductImage: order.firstProductImage
                }))
            });
        }
    );
});

// API lấy chi tiết đơn hàng
router.get("/detail/:orderId", verifyToken, (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;

    // Lấy thông tin đơn hàng và danh sách sản phẩm trong một truy vấn
    connection.query(
        "SELECT o.id, o.created_at, o.total_price, " +
        "oi.product_id, p.name AS product_name, oi.quantity, oi.price, oi.image " +
        "FROM orders o " +
        "LEFT JOIN order_items oi ON o.id = oi.order_id " +
        "LEFT JOIN products p ON oi.product_id = p.product_id " +
        "WHERE o.id = ? AND o.user_id = ? AND (oi.product_id IS NOT NULL AND oi.product_id != 0 AND oi.quantity > 0)",
        [orderId, userId],
        (err, results) => {
            if (err) {
                console.log("❌ Database error:", err.message || err);
                return res.status(500).json({ message: "Lỗi database", error: err.message || err });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: "Đơn hàng không tồn tại hoặc không thuộc về bạn" });
            }

            // Lấy thông tin đơn hàng từ bản ghi đầu tiên
            const order = {
                id: results[0].id,
                order_date: results[0].created_at, // Sửa từ order_date thành created_at
                total_price: results[0].total_price
            };

            // Lấy danh sách sản phẩm
            const items = results
                .filter(row => row.product_id !== null && row.product_id != 0 && row.quantity > 0) // Loại bỏ các hàng không hợp lệ
                .map(row => ({
                    productId: row.product_id.toString(),
                    productName: row.product_name || "Unknown Product", // Đảm bảo product_name không null
                    quantity: row.quantity || 0, // Đảm bảo quantity không null
                    price: row.price || 0, // Đảm bảo price không null
                    image: row.image || "https://example.com/default-image.jpg" // Đảm bảo image không null
                }));

            // Log dữ liệu để kiểm tra
            console.log("Order details:", order);
            console.log("Items:", items);

            res.json({
                success: true,
                message: "Lấy chi tiết đơn hàng thành công",
                order: {
                    orderId: order.id.toString(),
                    orderDate: order.order_date ? order.order_date.toISOString().split("T")[0] : null,
                    totalPrice: order.total_price,
                    items: items
                }
            });
        }
    );
});

// API tạo đơn hàng (giữ nguyên như bạn đã cung cấp)
router.post("/create", verifyToken, async (req, res) => {
    const { items, total_price, payment_method, name, phone, address } = req.body;
    const userId = req.user.id;

    if (!items || !total_price || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo đơn hàng" });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Danh sách sản phẩm không hợp lệ" });
    }

    // Lọc bỏ các mục không hợp lệ
    const validItems = items.filter(item => item.product_id != 0 && item.quantity > 0);
    if (validItems.length === 0) {
        return res.status(400).json({ message: "Không có sản phẩm hợp lệ để tạo đơn hàng" });
    }

    const productIds = validItems.map(item => item.product_id);

    try {
        connection.beginTransaction(async (err) => {
            if (err) {
                console.log("❌ Transaction error:", err.message || err);
                return res.status(500).json({ message: "Lỗi giao dịch", error: err.message || err });
            }

            try {
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

                const productMap = {};
                products.forEach(prod => {
                    let imageUrl = null;
                    try {
                        if (typeof prod.images === 'string' && prod.images.startsWith('http')) {
                            imageUrl = prod.images;
                        } else {
                            const imagesArray = JSON.parse(prod.images);
                            imageUrl = imagesArray.length > 0 ? imagesArray[0] : null;
                        }
                    } catch (error) {
                        console.log(`❌ Error parsing images for product ${prod.product_id}:`, error.message);
                        imageUrl = null;
                    }

                    productMap[prod.product_id] = {
                        name: prod.name,
                        price: prod.price,
                        quantity: prod.quantity,
                        image: imageUrl || "https://example.com/default-image.jpg"
                    };
                });

                const invalidItems = validItems.filter(item => !productMap[item.product_id]);
                if (invalidItems.length > 0) {
                    return connection.rollback(() => {
                        res.status(400).json({ 
                            message: "Phát hiện sản phẩm không hợp lệ", 
                            invalid_products: invalidItems 
                        });
                    });
                }

                for (const item of validItems) {
                    if (item.quantity > productMap[item.product_id].quantity) {
                        return connection.rollback(() => {
                            res.status(400).json({ 
                                message: `Không đủ hàng trong kho cho sản phẩm ${productMap[item.product_id].name}`, 
                                product_id: item.product_id 
                            });
                        });
                    }
                }

                let calculatedTotalPrice = 0;
                const orderItemsValues = validItems.map(item => {
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

                const orderItemsQuery = "INSERT INTO order_items (order_id, product_name, product_id, quantity, price, image) VALUES ?";
                const orderItemsWithOrderId = orderItemsValues.map(item => [orderId, item[0], item[1], item[2], item[3], item[4]]);
                await new Promise((resolve, reject) => {
                    connection.query(orderItemsQuery, [orderItemsWithOrderId], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                const updateStockQueries = validItems.map(item => {
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

                if (payment_method === "ZaloPay") {
                    const zaloPayResponse = await createZaloPayOrder(calculatedTotalPrice, orderId);

                    if (zaloPayResponse.return_code === 1) {
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
                        await new Promise((resolve) => {
                            connection.rollback(resolve);
                        });
                        res.status(500).json({
                            message: "Không thể tạo đơn hàng trên ZaloPay",
                            zaloPayResponse,
                        });
                    }
                } else {
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