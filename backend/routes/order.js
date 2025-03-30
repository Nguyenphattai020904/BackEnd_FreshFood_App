const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");
const { createZaloPayOrder, queryZaloPayOrder } = require("../utils/zalopay");

const router = express.Router();

// Hàm tạo app_trans_id duy nhất
const generateAppTransId = async () => {
    let appTransId;
    let exists = true;
    while (exists) {
        appTransId = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        const result = await new Promise((resolve, reject) => {
            connection.query(
                "SELECT id FROM pending_orders WHERE app_trans_id = ?",
                [appTransId],
                (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                }
            );
        });
        exists = result.length > 0;
    }
    return appTransId;
};

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
router.get("/order-status/:orderId", async (req, res) => {
    const { orderId } = req.params;
    console.log(`📩 Received request to check order status: orderId=${orderId}`);

    // Kiểm tra trong bảng orders trước
    connection.query(
        "SELECT payment_status FROM orders WHERE id = ?23",
        [orderId],
        async (err, results) => {
            if (err) {
                console.log("❌ Database error:", err.message || err);
                return res.status(500).json({ message: "Lỗi database", error: err.message || err });
            }
            if (results.length > 0) {
                console.log(`✅ Order status checked: orderId=${orderId}, payment_status=${results[0].payment_status}`);
                return res.json({ payment_status: results[0].payment_status });
            }

            // Kiểm tra trong pending_orders
            connection.query(
                "SELECT payment_status, app_trans_id FROM pending_orders WHERE id = ?",
                [orderId],
                async (err, pendingResults) => {
                    if (err) {
                        console.log("❌ Database error:", err.message || err);
                        return res.status(500).json({ message: "Lỗi database", error: err.message || err });
                    }
                    if (pendingResults.length === 0) {
                        console.log(`❌ Order not found: orderId=${orderId}`);
                        return res.status(404).json({ message: "Đơn hàng không tồn tại" });
                    }

                    // Nếu trạng thái là waiting_payment, kiểm tra qua ZaloPay
                    if (pendingResults[0].payment_status === "waiting_payment") {
                        try {
                            const zaloPayStatus = await queryZaloPayOrder(pendingResults[0].app_trans_id);
                            if (zaloPayStatus.return_code === 1 && zaloPayStatus.is_processing === 0) {
                                // Giao dịch đã hoàn tất
                                if (zaloPayStatus.status === 1) {
                                    // Chuyển từ pending_orders sang orders
                                    const pendingOrder = await new Promise((resolve, reject) => {
                                        connection.query(
                                            "SELECT * FROM pending_orders WHERE id = ?",
                                            [orderId],
                                            (err, results) => {
                                                if (err) reject(err);
                                                else resolve(results);
                                            }
                                        );
                                    });

                                    if (!pendingOrder || pendingOrder.length === 0) {
                                        return res.status(404).json({ message: "Đơn hàng tạm không tồn tại" });
                                    }

                                    const orderData = pendingOrder[0];
                                    const orderResult = await new Promise((resolve, reject) => {
                                        connection.query(
                                            "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
                                            [orderData.user_id, orderData.total_price, orderData.payment_method, orderData.name, orderData.phone, orderData.address, "paid", orderData.created_at],
                                            (err, result) => {
                                                if (err) reject(err);
                                                else resolve(result);
                                            }
                                        );
                                    });

                                    const newOrderId = orderResult.insertId;

                                    // Chuyển danh sách sản phẩm từ pending_order_items sang order_items
                                    const pendingItems = await new Promise((resolve, reject) => {
                                        connection.query(
                                            "SELECT * FROM pending_order_items WHERE pending_order_id = ?",
                                            [orderId],
                                            (err, results) => {
                                                if (err) reject(err);
                                                else resolve(results);
                                            }
                                        );
                                    });

                                    const orderItemsQuery = "INSERT INTO order_items (order_id, product_name, product_id, quantity, price, image) VALUES ?";
                                    const orderItemsValues = pendingItems.map(item => [
                                        newOrderId,
                                        item.product_name,
                                        item.product_id,
                                        item.quantity,
                                        item.price,
                                        item.image
                                    ]);
                                    await new Promise((resolve, reject) => {
                                        connection.query(orderItemsQuery, [orderItemsValues], (err) => {
                                            if (err) reject(err);
                                            else resolve();
                                        });
                                    });

                                    // Cập nhật số lượng sản phẩm
                                    const updateStockQueries = pendingItems.map(item => {
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

                                    // Xóa dữ liệu từ pending_orders và pending_order_items
                                    await new Promise((resolve, reject) => {
                                        connection.query(
                                            "DELETE FROM pending_order_items WHERE pending_order_id = ?",
                                            [orderId],
                                            (err) => {
                                                if (err) reject(err);
                                                else resolve();
                                            }
                                        );
                                    });

                                    await new Promise((resolve, reject) => {
                                        connection.query(
                                            "DELETE FROM pending_orders WHERE id = ?",
                                            [orderId],
                                            (err) => {
                                                if (err) reject(err);
                                                else resolve();
                                            }
                                        );
                                    });

                                    res.json({ payment_status: "paid" });
                                } else {
                                    res.json({ payment_status: "waiting_payment" });
                                }
                            } else {
                                res.json({ payment_status: pendingResults[0].payment_status });
                            }
                        } catch (error) {
                            console.error("❌ Error querying ZaloPay:", error);
                            res.json({ payment_status: pendingResults[0].payment_status });
                        }
                    } else {
                        res.json({ payment_status: pendingResults[0].payment_status });
                    }
                }
            );
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
                order_date: results[0].created_at,
                total_price: results[0].total_price
            };

            // Lấy danh sách sản phẩm
            const items = results
                .filter(row => row.product_id !== null && row.product_id != 0 && row.quantity > 0)
                .map(row => ({
                    productId: row.product_id.toString(),
                    productName: row.product_name || "Unknown Product",
                    quantity: row.quantity || 0,
                    price: row.price || 0,
                    image: row.image || "https://example.com/default-image.jpg"
                }));

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

// API tạo đơn hàng
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
                // Kiểm tra người dùng
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

                // Kiểm tra sản phẩm
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

                // Kiểm tra số lượng tồn kho
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

                // Tính tổng giá
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

                if (payment_method === "ZaloPay") {
                    const appTransId = await generateAppTransId();
                    console.log("Generated app_trans_id:", appTransId);
                
                    // Lưu đơn hàng vào bảng pending_orders
                    const pendingOrderResult = await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO pending_orders (user_id, total_price, payment_method, name, phone, address, payment_status, app_trans_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            [userId, calculatedTotalPrice, payment_method, name, phone, address, "unpaid", appTransId],
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });
                
                    const pendingOrderId = pendingOrderResult.insertId;
                    console.log("Created pending order with ID:", pendingOrderId);
                
                    // Lưu danh sách sản phẩm vào pending_order_items
                    const orderItemsQuery = "INSERT INTO pending_order_items (pending_order_id, product_name, product_id, quantity, price, image) VALUES ?";
                    const orderItemsWithPendingOrderId = orderItemsValues.map(item => [pendingOrderId, item[0], item[1], item[2], item[3], item[4]]);
                    await new Promise((resolve, reject) => {
                        connection.query(orderItemsQuery, [orderItemsWithPendingOrderId], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                
                    // Tạo đơn hàng ZaloPay
                    console.log("Calling createZaloPayOrder with:", { amount: calculatedTotalPrice, pendingOrderId, appTransId });
                    const zaloPayResponse = await createZaloPayOrder(calculatedTotalPrice, pendingOrderId, appTransId);
                    console.log("ZaloPay Response in /order/create:", zaloPayResponse);
                
                    if (zaloPayResponse.return_code === 1) {
                        await new Promise((resolve, reject) => {
                            connection.query(
                                "UPDATE pending_orders SET payment_status = 'waiting_payment' WHERE id = ?",
                                [pendingOrderId],
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
                            message: "Đơn hàng tạm thời đã được tạo, chờ thanh toán",
                            pendingOrderId,
                            total_price: calculatedTotalPrice,
                            zaloPay_url: zaloPayResponse.order_url,
                        });
                    } else {
                        console.error("❌ Failed to create ZaloPay order:", zaloPayResponse);
                        await new Promise((resolve) => {
                            connection.rollback(resolve);
                        });
                        res.status(500).json({
                            message: "Không thể tạo đơn hàng trên ZaloPay",
                            zaloPayResponse,
                        });
                    }
                } else {
                    // Xử lý COD: Lưu trực tiếp vào bảng orders vì không cần chờ thanh toán
                    const orderResult = await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
                            [userId, calculatedTotalPrice, payment_method, name, phone, address, "pending"],
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

                    // Cập nhật số lượng sản phẩm
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

// API nhận callback từ ZaloPay (giữ nguyên vì không sử dụng callback_url)
router.post("/zalopay-callback", (req, res) => {
    const { data, mac } = req.body;

    // Xác minh tính hợp lệ của callback
    const crypto = require("crypto");
    const config = require("../utils/zalopay").config;
    const computedMac = crypto.createHmac("sha256", config.key2)
        .update(data)
        .digest("hex");

    if (computedMac !== mac) {
        console.log("❌ Invalid MAC in ZaloPay callback:", mac);
        return res.status(400).json({ message: "Invalid MAC" });
    }

    // Parse dữ liệu từ callback
    const callbackData = JSON.parse(data);
    const { app_trans_id, status, amount } = callbackData;
    const embedData = callbackData.embed_data ? JSON.parse(callbackData.embed_data) : {};
    const pendingOrderId = embedData.pendingOrderId;

    if (!pendingOrderId) {
        console.log("❌ Missing pendingOrderId in ZaloPay callback:", callbackData);
        return res.status(400).json({ message: "Missing pendingOrderId" });
    }

    // Bắt đầu giao dịch
    connection.beginTransaction(async (err) => {
        if (err) {
            console.log("❌ Transaction error:", err.message || err);
            return res.status(500).json({ message: "Lỗi giao dịch", error: err.message || err });
        }

        try {
            // Lấy thông tin đơn hàng từ pending_orders
            const pendingOrder = await new Promise((resolve, reject) => {
                connection.query(
                    "SELECT * FROM pending_orders WHERE id = ? AND app_trans_id = ?",
                    [pendingOrderId, app_trans_id],
                    (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    }
                );
            });

            if (!pendingOrder || pendingOrder.length === 0) {
                return connection.rollback(() => {
                    console.log("❌ Pending order not found:", pendingOrderId);
                    res.status(404).json({ message: "Đơn hàng tạm không tồn tại" });
                });
            }

            const orderData = pendingOrder[0];

            // Lấy danh sách sản phẩm từ pending_order_items
            const pendingItems = await new Promise((resolve, reject) => {
                connection.query(
                    "SELECT * FROM pending_order_items WHERE pending_order_id = ?",
                    [pendingOrderId],
                    (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    }
                );
            });

            if (status === 1) { // Thanh toán thành công
                // Thêm đơn hàng vào bảng orders
                const orderResult = await new Promise((resolve, reject) => {
                    connection.query(
                        "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
                        [orderData.user_id, orderData.total_price, orderData.payment_method, orderData.name, orderData.phone, orderData.address, "paid", orderData.created_at],
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });

                const orderId = orderResult.insertId;

                // Thêm danh sách sản phẩm vào order_items
                const orderItemsQuery = "INSERT INTO order_items (order_id, product_name, product_id, quantity, price, image) VALUES ?";
                const orderItemsValues = pendingItems.map(item => [
                    orderId,
                    item.product_name,
                    item.product_id,
                    item.quantity,
                    item.price,
                    item.image
                ]);
                await new Promise((resolve, reject) => {
                    connection.query(orderItemsQuery, [orderItemsValues], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                // Cập nhật số lượng sản phẩm
                const updateStockQueries = pendingItems.map(item => {
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
            }

            // Xóa dữ liệu từ pending_orders và pending_order_items
            await new Promise((resolve, reject) => {
                connection.query(
                    "DELETE FROM pending_order_items WHERE pending_order_id = ?",
                    [pendingOrderId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            await new Promise((resolve, reject) => {
                connection.query(
                    "DELETE FROM pending_orders WHERE id = ?",
                    [pendingOrderId],
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

            console.log(`✅ ZaloPay callback processed: pendingOrderId=${pendingOrderId}, status=${status === 1 ? "paid" : "failed"}`);
            res.json({ return_code: 1, return_message: "Success" });
        } catch (error) {
            console.log("❌ Transaction error in ZaloPay callback:", error.message || error);
            await new Promise((resolve) => {
                connection.rollback(resolve);
            });
            res.status(500).json({ message: "Lỗi trong quá trình xử lý callback", error: error.message || error });
        }
    });
});

module.exports = router;