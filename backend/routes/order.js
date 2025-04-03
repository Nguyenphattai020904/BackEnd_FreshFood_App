const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");
const { createZaloPayOrder, queryZaloPayOrder } = require("../utils/zalopay");
const crypto = require("crypto");

const router = express.Router();

// Config ZaloPay
const config = {
    app_id: "2554",
    key1: "sdngKKJmqEMzvh5QQcdD2A9XBSKUNaYn",
    key2: "trMrHtvjo6myautxDUiAcYsVtaeQ8nhf",
    endpoint_create: "https://sb-openapi.zalopay.vn/v2/create",
    endpoint_query: "https://sb-openapi.zalopay.vn/v2/query",
    callback_url: "https://d7b0-113-161-85-254.ngrok-free.app/order/zalopay-callback" // Thay bằng ngrok URL mới
};

// Hàm tạo app_trans_id duy nhất
const generateAppTransId = async () => {
    const date = new Date();
    const yyMMdd = date.toISOString().slice(2, 10).replace(/-/g, '');
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const appTransId = `${yyMMdd}_${randomNum}`;
    console.log("Generated app_trans_id:", appTransId);
    return appTransId;
};

// Lấy tất cả đơn hàng (không cần xác thực)
router.get("/all", (req, res) => {
    console.log("📩 Request to /order/all received at:", new Date().toISOString());
    console.log("Request headers:", req.headers);
    connection.query(
        "SELECT * FROM orders",
        (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return res.status(500).json({ message: "Database error", error: err.message });
            }
            res.json({ orders: results });
        }
    );
});

// API lấy danh sách sản phẩm (không cần xác thực)
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
    console.log(`📩 Checking order status: orderId=${orderId}`);

    // Kiểm tra trong orders trước
    const orderResult = await new Promise((resolve, reject) => {
        connection.query(
            "SELECT id, payment_status FROM orders WHERE id = ?",
            [orderId],
            (err, results) => {
                if (err) reject(err);
                else resolve(results);
            }
        );
    });

    if (orderResult.length > 0) {
        console.log(`✅ Found in orders: payment_status=${orderResult[0].payment_status}`);
        return res.json({ payment_status: orderResult[0].payment_status, newOrderId: orderResult[0].id });
    }

    // Kiểm tra trong pending_orders
    const pendingResult = await new Promise((resolve, reject) => {
        connection.query(
            "SELECT payment_status, app_trans_id FROM pending_orders WHERE id = ?",
            [orderId],
            (err, results) => {
                if (err) reject(err);
                else resolve(results);
            }
        );
    });

    if (pendingResult.length > 0) {
        const { payment_status, app_trans_id } = pendingResult[0];
        console.log(`⏳ Found in pending_orders: app_trans_id=${app_trans_id}, status=${payment_status}`);

        if (payment_status === "waiting_payment") {
            try {
                const zaloPayStatus = await queryZaloPayOrder(app_trans_id);
                console.log(`ZaloPay Status: ${JSON.stringify(zaloPayStatus)}`);

                if (zaloPayStatus.return_code === 1 && zaloPayStatus.amount > 0) {
                    // Nếu ZaloPay xác nhận thanh toán, cập nhật trạng thái trong pending_orders
                    await new Promise((resolve, reject) => {
                        connection.query(
                            "UPDATE pending_orders SET payment_status = 'paid' WHERE id = ?",
                            [orderId],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });

                    // Tạo bản ghi trong orders
                    const pendingOrder = await new Promise((resolve, reject) => {
                        connection.query(
                            "SELECT * FROM pending_orders WHERE id = ?",
                            [orderId],
                            (err, results) => {
                                if (err) reject(err);
                                else resolve(results[0]);
                            }
                        );
                    });

                    const orderResult = await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id) VALUES (?, ?, 'pending', ?, ?, ?, ?, 'paid', NOW(), ?, ?)",
                            [pendingOrder.user_id, pendingOrder.total_price, pendingOrder.payment_method, pendingOrder.name, pendingOrder.phone, pendingOrder.address, pendingOrder.voucher_id || null, app_trans_id],
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });

                    const newOrderId = orderResult.insertId;

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
                        newOrderId, item.product_name, item.product_id, item.quantity, item.price, item.image
                    ]);
                    await new Promise((resolve, reject) => {
                        connection.query(orderItemsQuery, [orderItemsValues], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

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

                    const notificationMessage = `Bạn đã thanh toán thành công qua ZaloPay, mã đơn hàng: ${newOrderId}`;
                    await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'order_success', ?, ?)",
                            [pendingOrder.user_id, notificationMessage, newOrderId],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });

                    console.log(`✅ Payment completed: newOrderId=${newOrderId}`);
                    return res.json({ payment_status: "paid", newOrderId: newOrderId });
                }
                console.log(`⏳ Still waiting: app_trans_id=${app_trans_id}`);
                return res.json({ payment_status: "waiting_payment" });
            } catch (error) {
                console.error("❌ Error querying ZaloPay:", error);
                return res.status(500).json({ message: "Lỗi kiểm tra trạng thái ZaloPay", error: error.message });
            }
        } else if (payment_status === "paid") {
            // Nếu trạng thái đã là 'paid', tìm newOrderId trong orders
            const orderByAppTransId = await new Promise((resolve, reject) => {
                connection.query(
                    "SELECT id, payment_status FROM orders WHERE app_trans_id = ?",
                    [app_trans_id],
                    (err, results) => {
                        if (err) reject(err);
                        else resolve(results);
                    }
                );
            });

            if (orderByAppTransId.length > 0) {
                console.log(`✅ Found in orders by app_trans_id: payment_status=${orderByAppTransId[0].payment_status}, newOrderId=${orderByAppTransId[0].id}`);
                return res.json({ payment_status: orderByAppTransId[0].payment_status, newOrderId: orderByAppTransId[0].id });
            }
        }
        return res.json({ payment_status: payment_status });
    }

    console.log(`❌ Order not found: orderId=${orderId}`);
    return res.status(404).json({ message: "Đơn hàng không tồn tại" });
});

// API lấy danh sách đơn hàng của người dùng
router.get("/:userId", verifyToken, (req, res) => {
    const { userId } = req.params;

    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    connection.query(
        `SELECT o.id AS orderId, o.created_at AS orderDate, o.total_price AS totalPrice,
                COALESCE(
                    (SELECT oi.image FROM order_items oi WHERE oi.order_id = o.id LIMIT 1),
                    'https://example.com/default-image.jpg'
                ) AS firstProductImage
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
                    firstProductImage: order.firstProductImage || "https://example.com/default-image.jpg"
                }))
            });
        }
    );
});

// API lấy chi tiết đơn hàng
router.get("/detail/:orderId", verifyToken, (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;

    connection.query(
        "SELECT o.id, o.created_at, o.total_price, o.voucher_id, " +
        "oi.product_id, p.name AS product_name, oi.quantity, oi.price, oi.image, " +
        "v.voucher_type, v.voucher_value " +
        "FROM orders o " +
        "LEFT JOIN order_items oi ON o.id = oi.order_id " +
        "LEFT JOIN products p ON oi.product_id = p.product_id " +
        "LEFT JOIN vouchers v ON o.voucher_id = v.voucher_id " +
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

            const order = {
                id: results[0].id,
                order_date: results[0].created_at,
                total_price: results[0].total_price,
                voucher_id: results[0].voucher_id,
                voucher_type: results[0].voucher_type,
                voucher_value: results[0].voucher_value
            };

            const finalTotalPrice = order.total_price;

            const items = results
                .filter(row => row.product_id !== null && row.product_id != 0 && row.quantity > 0)
                .map(row => ({
                    productId: row.product_id.toString(),
                    productName: row.product_name || "Unknown Product",
                    quantity: row.quantity || 0,
                    price: row.price || 0,
                    image: row.image || "https://example.com/default-image.jpg"
                }));

            console.log("Order details:", { ...order, final_total_price: finalTotalPrice });
            console.log("Items:", items);

            res.json({
                success: true,
                message: "Lấy chi tiết đơn hàng thành công",
                order: {
                    orderId: order.id.toString(),
                    orderDate: order.order_date ? order.order_date.toISOString().split("T")[0] : null,
                    totalPrice: finalTotalPrice,
                    items: items
                }
            });
        }
    );
});

// API tạo đơn hàng
router.post("/create", verifyToken, async (req, res) => {
    const { items, total_price, payment_method, name, phone, address, voucher_id } = req.body;
    const userId = req.user.id;

    if (!items || !total_price || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo đơn hàng" });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Danh sách sản phẩm không hợp lệ" });
    }

    const validItems = items.filter(item => item.product_id != 0 && item.quantity > 0);
    if (validItems.length === 0) {
        return res.status(400).json({ message: "Không có sản phẩm hợp lệ để tạo đơn hàng" });
    }

    const productIds = validItems.map(item => item.product_id);

    try {
        connection.beginTransaction(async (err) => {
            if (err) {
                return res.status(500).json({ message: "Lỗi giao dịch", error: err.message });
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
                        res.status(400).json({ message: "Người dùng không tồn tại" });
                    });
                }

                const products = await new Promise((resolve, reject) => {
                    connection.query(
                        "SELECT product_id, name, final_price, quantity, images FROM products WHERE product_id IN (?)",
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
                        imageUrl = null;
                    }
                    productMap[prod.product_id] = {
                        name: prod.name,
                        price: prod.final_price,
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
                    const unitPrice = productInfo.price;
                    const itemTotalPrice = item.quantity * unitPrice;
                    calculatedTotalPrice += itemTotalPrice;
                    return [productInfo.name, item.product_id, item.quantity, unitPrice, productInfo.image];
                });

                calculatedTotalPrice = Number(calculatedTotalPrice.toFixed(2));

                let discount = 0;
                let finalTotalPrice = calculatedTotalPrice;
                if (voucher_id && voucher_id !== 0) {
                    const voucher = await new Promise((resolve, reject) => {
                        connection.query(
                            "SELECT * FROM vouchers WHERE voucher_id = ? AND user_id = ? AND voucher_quantity > 0 AND voucher_date >= CURDATE()",
                            [voucher_id, userId],
                            (err, results) => {
                                if (err) reject(err);
                                else resolve(results[0]);
                            }
                        );
                    });

                    if (!voucher) {
                        return connection.rollback(() => {
                            res.status(400).json({ message: "Voucher không hợp lệ hoặc đã hết hạn" });
                        });
                    }

                    if (calculatedTotalPrice < voucher.min_order_value) {
                        return connection.rollback(() => {
                            res.status(400).json({ 
                                message: `Đơn hàng phải từ ${voucher.min_order_value} VND để dùng voucher này` 
                            });
                        });
                    }

                    if (voucher.voucher_type === 'percentage') {
                        discount = calculatedTotalPrice * (voucher.voucher_value / 100);
                    } else if (voucher.voucher_type === 'fixed') {
                        discount = voucher.voucher_value;
                    }

                    discount = Number(discount.toFixed(2));
                    finalTotalPrice = calculatedTotalPrice - discount;
                }

                const clientTotalPrice = Number(total_price.toFixed(2));
                console.log("Calculated Total Price:", calculatedTotalPrice, "Discount:", discount, "Final Total Price:", finalTotalPrice);
                console.log("Client Total Price Received:", clientTotalPrice);

                if (payment_method === "ZaloPay") {
                    const appTransId = await generateAppTransId();
                    const pendingOrderResult = await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO pending_orders (user_id, total_price, payment_method, name, phone, address, payment_status, app_trans_id, voucher_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [userId, finalTotalPrice, payment_method, name, phone, address, "unpaid", appTransId, voucher_id || null],
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });

                    const pendingOrderId = pendingOrderResult.insertId;
                    const orderItemsQuery = "INSERT INTO pending_order_items (pending_order_id, product_name, product_id, quantity, price, image) VALUES ?";
                    const orderItemsWithPendingOrderId = orderItemsValues.map(item => [pendingOrderId, item[0], item[1], item[2], item[3], item[4]]);
                    await new Promise((resolve, reject) => {
                        connection.query(orderItemsQuery, [orderItemsWithPendingOrderId], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    console.log("Creating ZaloPay order with finalTotalPrice:", finalTotalPrice);
                    const zaloPayResponse = await createZaloPayOrder(finalTotalPrice, pendingOrderId, appTransId);
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

                        connection.commit((err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    res.status(500).json({ message: "Lỗi commit giao dịch", error: err.message });
                                });
                            }
                            res.json({
                                success: true,
                                message: "Đơn hàng ZaloPay đã được tạo",
                                pendingOrderId,
                                zaloPayUrl: zaloPayResponse.order_url
                            });
                        });
                    } else {
                        return connection.rollback(() => {
                            res.status(500).json({ message: "Lỗi tạo đơn hàng ZaloPay", error: zaloPayResponse });
                        });
                    }
                } else if (payment_method === "COD") {
                    const orderResult = await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NOW(), ?)",
                            [userId, finalTotalPrice, payment_method, name, phone, address, "unpaid", voucher_id || null],
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

                    const orderDate = new Date().toISOString().split("T")[0];
                    const notificationMessage = `Bạn đã đặt hàng thành công qua COD, mã đơn hàng: ${orderId}, ngày đặt hàng: ${orderDate}`;
                    await new Promise((resolve, reject) => {
                        connection.query(
                            "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'order_success', ?, ?)",
                            [userId, notificationMessage, orderId],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });

                    connection.commit((err) => {
                        if (err) {
                            return connection.rollback(() => {
                                res.status(500).json({ message: "Lỗi commit giao dịch", error: err.message });
                            });
                        }
                        res.json({
                            success: true,
                            message: "Đơn hàng COD đã được tạo",
                            orderId: orderId
                        });
                    });
                } else {
                    return connection.rollback(() => {
                        res.status(400).json({ message: "Phương thức thanh toán không được hỗ trợ" });
                    });
                }
            } catch (error) {
                console.error("❌ Transaction error:", error);
                return connection.rollback(() => {
                    res.status(500).json({ message: "Lỗi xử lý đơn hàng", error: error.message });
                });
            }
        });
    } catch (error) {
        console.error("❌ Unexpected error:", error);
        res.status(500).json({ message: "Lỗi máy chủ", error: error.message });
    }
});

// API tính tổng giá
router.post("/calculate-total", verifyToken, async (req, res) => {
    const { items, voucher_id } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Danh sách sản phẩm không hợp lệ" });
    }

    const validItems = items.filter(item => item.product_id != 0 && item.quantity > 0);
    if (validItems.length === 0) {
        return res.status(400).json({ message: "Không có sản phẩm hợp lệ để tính tổng" });
    }

    const productIds = validItems.map(item => item.product_id);

    try {
        const products = await new Promise((resolve, reject) => {
            connection.query(
                "SELECT product_id, final_price, quantity FROM products WHERE product_id IN (?)",
                [productIds],
                (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                }
            );
        });

        const productMap = {};
        products.forEach(prod => {
            productMap[prod.product_id] = { price: prod.final_price, quantity: prod.quantity };
        });

        const invalidItems = validItems.filter(item => !productMap[item.product_id]);
        if (invalidItems.length > 0) {
            return res.status(400).json({ message: "Phát hiện sản phẩm không hợp lệ", invalid_products: invalidItems });
        }

        for (const item of validItems) {
            if (item.quantity > productMap[item.product_id].quantity) {
                return res.status(400).json({ 
                    message: `Không đủ hàng trong kho cho sản phẩm ID ${item.product_id}`, 
                    product_id: item.product_id 
                });
            }
        }

        let totalPrice = 0;
        validItems.forEach(item => {
            const unitPrice = productMap[item.product_id].price;
            totalPrice += item.quantity * unitPrice;
        });

        totalPrice = Number(totalPrice.toFixed(2));

        let discount = 0;
        let finalTotalPrice = totalPrice;
        if (voucher_id && voucher_id !== 0) {
            const voucher = await new Promise((resolve, reject) => {
                connection.query(
                    "SELECT * FROM vouchers WHERE voucher_id = ? AND user_id = ? AND voucher_quantity > 0 AND voucher_date >= CURDATE()",
                    [voucher_id, req.user.id],
                    (err, results) => {
                        if (err) reject(err);
                        else resolve(results[0]);
                    }
                );
            });

            if (!voucher) {
                return res.status(400).json({ message: "Voucher không hợp lệ hoặc đã hết hạn" });
            }

            if (totalPrice < voucher.min_order_value) {
                return res.status(400).json({ 
                    message: `Đơn hàng phải từ ${voucher.min_order_value} VND để dùng voucher này` 
                });
            }

            if (voucher.voucher_type === 'percentage') {
                discount = totalPrice * (voucher.voucher_value / 100);
            } else if (voucher.voucher_type === 'fixed') {
                discount = voucher.voucher_value;
            }

            discount = Number(discount.toFixed(2));
            finalTotalPrice = totalPrice - discount;
        }

        console.log("Calculate-total: Total price =", totalPrice, ", Discount =", discount, ", Final Total =", finalTotalPrice);
        res.json({ total_price: finalTotalPrice });
    } catch (error) {
        console.error("❌ Error calculating total:", error);
        res.status(500).json({ message: "Lỗi tính tổng giá", error: error.message });
    }
});

// ZaloPay Callback
router.post("/zalopay-callback", async (req, res) => {
    const { data, mac } = req.body;
    console.log("📩 ZaloPay Callback received at:", new Date().toISOString());
    console.log("Full request headers:", req.headers);
    console.log("Full request body:", req.body);

    try {
        const dataStr = data;
        const expectedMac = crypto.createHmac("sha256", config.key2)
            .update(dataStr)
            .digest("hex");

        console.log("Callback Data String:", dataStr);
        console.log("Expected MAC:", expectedMac);
        console.log("Received MAC:", mac);

        if (expectedMac !== mac) {
            console.log("❌ Invalid MAC");
            return res.status(400).json({ return_code: 0, return_message: "Invalid MAC" });
        }

        const dataObj = JSON.parse(data);
        const { app_trans_id } = dataObj;

        const pendingOrder = await new Promise((resolve, reject) => {
            connection.query(
                "SELECT * FROM pending_orders WHERE app_trans_id = ?",
                [app_trans_id],
                (err, results) => {
                    if (err) reject(err);
                    else resolve(results[0]);
                }
            );
        });

        if (!pendingOrder) {
            console.log("❌ Pending order not found for app_trans_id:", app_trans_id);
            return res.status(404).json({ message: "Không tìm thấy đơn hàng chờ" });
        }

        // Thêm vào orders
        const orderResult = await new Promise((resolve, reject) => {
            connection.query(
                "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id) VALUES (?, ?, 'pending', ?, ?, ?, ?, 'paid', ?, ?, ?)",
                [pendingOrder.user_id, pendingOrder.total_price, pendingOrder.payment_method, pendingOrder.name, pendingOrder.phone, pendingOrder.address, pendingOrder.created_at, pendingOrder.voucher_id || null, app_trans_id],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });

        const newOrderId = orderResult.insertId;

        // Sao chép items từ pending_order_items sang order_items
        const pendingItems = await new Promise((resolve, reject) => {
            connection.query(
                "SELECT * FROM pending_order_items WHERE pending_order_id = ?",
                [pendingOrder.id],
                (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                }
            );
        });

        const orderItemsQuery = "INSERT INTO order_items (order_id, product_name, product_id, quantity, price, image) VALUES ?";
        const orderItemsValues = pendingItems.map(item => [
            newOrderId, item.product_name, item.product_id, item.quantity, item.price, item.image
        ]);
        await new Promise((resolve, reject) => {
            connection.query(orderItemsQuery, [orderItemsValues], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Cập nhật kho
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

        // Cập nhật trạng thái trong pending_orders thành 'paid'
        await new Promise((resolve, reject) => {
            connection.query(
                "UPDATE pending_orders SET payment_status = 'paid' WHERE id = ?",
                [pendingOrder.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Thêm thông báo
        const orderDate = new Date(pendingOrder.created_at).toISOString().split("T")[0];
        const notificationMessage = `Bạn đã thanh toán thành công qua ZaloPay, mã đơn hàng: ${newOrderId}, ngày đặt hàng: ${orderDate}`;
        await new Promise((resolve, reject) => {
            connection.query(
                "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'order_success', ?, ?)",
                [pendingOrder.user_id, notificationMessage, newOrderId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        console.log(`✅ ZaloPay Callback processed: newOrderId=${newOrderId}`);
        res.json({ return_code: 1, return_message: "Success", newOrderId });
    } catch (error) {
        console.error("❌ ZaloPay Callback error:", error);
        res.status(500).json({ return_code: 0, return_message: "Failed to process callback", error: error.message });
    }
});

// Thêm đơn hàng từ admin (không cần xác thực)
router.post("/create-admin", (req, res) => {
    const { user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id } = req.body;

    if (!user_id || !total_price || !status || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để tạo đơn hàng" });
    }

    connection.query(
        "INSERT INTO orders (user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, total_price, status, payment_method, name, phone, address, payment_status || "unpaid", created_at || null, voucher_id || null, app_trans_id || null],
        (err, result) => {
            if (err) {
                console.error("❌ Error adding order:", err);
                return res.status(500).json({ message: "Error adding order", error: err.message });
            }
            res.json({ message: "Order added successfully", orderId: result.insertId });
        }
    );
});

// Cập nhật đơn hàng (không cần xác thực)
router.put("/:orderId", (req, res) => {
    const { orderId } = req.params;
    const { user_id, total_price, status, payment_method, name, phone, address, payment_status, created_at, voucher_id, app_trans_id } = req.body;

    if (!user_id || !total_price || !status || !payment_method || !name || !phone || !address) {
        return res.status(400).json({ message: "Thiếu thông tin cần thiết để cập nhật đơn hàng" });
    }

    connection.query(
        "UPDATE orders SET user_id = ?, total_price = ?, status = ?, payment_method = ?, name = ?, phone = ?, address = ?, payment_status = ?, created_at = ?, voucher_id = ?, app_trans_id = ? WHERE id = ?",
        [user_id, total_price, status, payment_method, name, phone, address, payment_status || "unpaid", created_at || null, voucher_id || null, app_trans_id || null, orderId],
        (err, results) => {
            if (err) {
                console.error("❌ Error updating order:", err);
                return res.status(500).json({ message: "Error updating order", error: err.message });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ message: "Order not found" });
            }
            res.json({ message: "Order updated successfully" });
        }
    );
});

router.delete("/:orderId", (req, res) => {
    const { orderId } = req.params;

    console.log(`📩 Request to delete order ${orderId} received at:`, new Date().toISOString());
    console.log("Request headers:", req.headers);
    connection.query(
        "DELETE FROM orders WHERE id = ?",
        [orderId],
        (err, results) => {
            if (err) {
                console.error("❌ Error deleting order:", err);
                return res.status(500).json({ message: "Error deleting order", error: err.message });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ message: "Order not found" });
            }
            res.json({ message: "Order deleted successfully" });
        }
    );
});
module.exports = router;