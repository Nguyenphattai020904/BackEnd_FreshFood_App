const express = require('express');
const db = require('../db');
const verifyToken = require('../middleware/auth');
const router = express.Router();
const cron = require('node-cron');
const util = require('util');

// Chuyển db.query thành Promise để sử dụng async/await
const queryAsync = util.promisify(db.query).bind(db);

// Định nghĩa ánh xạ hình ảnh cho các mức giảm giá
const discountImages = {
    10: 'https://product.hstatic.net/200000551679/product/tag-02_981847dea5e84b119913e34a60444fef_grande.png',
    20: 'https://product.hstatic.net/200000551679/product/tag-03_88e5f3eb05634ba0b653defd664b4853_grande.png',
    30: 'https://product.hstatic.net/200000551679/product/tag-06_6552a70c312a462f894288cfb8f947f7_grande.png',
    40: 'https://png.pngtree.com/png-vector/20221119/ourmid/pngtree-40-off-sale-promotion-png-image_6450809.png',
    50: 'https://maybanhang.net/wp-content/uploads/2014/05/43.jpg'
};

// API lấy số lượt quay
router.get('/count/:userId', verifyToken, async (req, res) => {
    console.log('GET /api/spin/count/:userId called');
    const { userId } = req.params;
    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    try {
        const results = await queryAsync("SELECT spin_count FROM spin_attempts WHERE user_id = ?", [userId]);
        if (results.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy thông tin lượt quay" });
        }
        res.json({ spinCount: results[0].spin_count });
    } catch (err) {
        console.error("❌ Error in GET /api/spin/count/:userId:", err.message);
        res.status(500).json({ message: "Lỗi database", error: err.message });
    }
});

// API quay vòng quay
router.post('/spin/:userId', verifyToken, async (req, res) => {
    console.log('POST /api/spin/spin/:userId called with userId:', req.params.userId);
    const { userId } = req.params;
    if (req.user.id != userId) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    try {
        // Kiểm tra lượt quay
        console.log("Checking spin count for user:", userId);
        const spinResults = await queryAsync("SELECT spin_count, consecutive_no_reward FROM spin_attempts WHERE user_id = ?", [userId]);
        if (spinResults.length === 0 || spinResults[0].spin_count <= 0) {
            return res.status(400).json({ message: "Bạn đã hết lượt quay!" });
        }

        // Lấy số lần liên tiếp không nhận được voucher
        const consecutiveNoReward = spinResults[0].consecutive_no_reward || 0;
        console.log(`User ${userId} has ${consecutiveNoReward} consecutive no-reward spins`);

        // Kiểm tra lần quay đầu tiên
        console.log("Checking if first spin for user:", userId);
        const spinCountResults = await queryAsync(
            "SELECT COUNT(*) as spinCount FROM vouchers WHERE user_id = ? AND voucher_name LIKE 'Voucher từ LuckyWheel%'",
            [userId]
        );
        const isFirstSpin = spinCountResults[0].spinCount === 0;
        let result;

        // Kiểm tra cơ chế bảo hiểm: Nếu 5 lần liên tiếp không nhận được voucher, lần này chắc chắn nhận 30%
        if (consecutiveNoReward >= 5) {
            console.log(`User ${userId} has 5 consecutive no-reward spins, guaranteeing 30% discount`);
            result = 30; // Chắc chắn nhận 30%
        } else if (isFirstSpin) {
            console.log("First spin for user:", userId, "-> 20% discount");
            result = 20; // Lần đầu 100% nhận 20%
        } else {
            // Kiểm tra số lượng voucher còn lại
            console.log("Fetching voucher limits...");
            const limits = await queryAsync("SELECT discount, current_quantity FROM voucher_limits");
            let availableDiscounts = limits.filter(l => l.current_quantity > 0).map(l => l.discount);

            if (availableDiscounts.length === 0) {
                console.log("No vouchers available, resetting voucher limits...");
                await queryAsync("UPDATE voucher_limits SET current_quantity = max_quantity");
                availableDiscounts = [10, 20, 30, 40, 50]; // Cập nhật lại danh sách
            }

            // Tính toán ngẫu nhiên
            console.log("Calculating random discount...");
            const rand = Math.random() * 100;
            if (rand < 60) result = 0; // 60% "Chúc bạn may mắn"
            else if (rand < 90) result = 10; // 30% 10%
            else if (rand < 98) result = 20; // 8% 20%
            else if (rand < 99.5) result = 30; // 1.5% 30%
            else if (rand < 99.8) result = 40; // 0.3% 40%
            else result = 50; // 0.2% 50%

            // Nếu discount không còn, trả về "Chúc bạn may mắn"
            if (result !== 0 && !availableDiscounts.includes(result)) {
                console.log("Discount", result, "not available, setting result to 0");
                result = 0;
            }
        }

        // Trừ lượt quay
        console.log("Deducting spin count for user:", userId);
        await queryAsync("UPDATE spin_attempts SET spin_count = spin_count - 1 WHERE user_id = ?", [userId]);

        // Cập nhật consecutive_no_reward
        if (result === 0) {
            // Tăng số lần liên tiếp không nhận được voucher
            console.log(`User ${userId} got no reward, incrementing consecutive_no_reward`);
            await queryAsync(
                "UPDATE spin_attempts SET consecutive_no_reward = consecutive_no_reward + 1 WHERE user_id = ?",
                [userId]
            );
        } else {
            // Reset số lần liên tiếp khi nhận được voucher
            console.log(`User ${userId} got a reward, resetting consecutive_no_reward`);
            await queryAsync(
                "UPDATE spin_attempts SET consecutive_no_reward = 0 WHERE user_id = ?",
                [userId]
            );
        }

        if (result === 0) {
            console.log("Result: Chúc bạn may mắn lần sau!");
            return res.json({ result: "Chúc bạn may mắn lần sau!", imageUrl: null });
        }

        // Trừ số lượng voucher
        console.log("Deducting voucher quantity for discount:", result);
        await queryAsync("UPDATE voucher_limits SET current_quantity = current_quantity - 1 WHERE discount = ?", [result]);

        // Thêm voucher cho user
        const voucherName = `Voucher từ LuckyWheel ${result}%`;
        const voucherType = 'percentage';
        const voucherValue = result;
        const voucherDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Hết hạn sau 7 ngày
        const minOrderValue = 0;
        const voucherImage = discountImages[result] || null; // Lấy URL hình ảnh

        console.log("Adding voucher for user:", userId, "Voucher:", voucherName);
        const voucherResult = await queryAsync(
            "INSERT INTO vouchers (user_id, voucher_name, voucher_type, voucher_value, voucher_date, min_order_value, voucher_quantity, voucher_image) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
            [userId, voucherName, voucherType, voucherValue, voucherDate, minOrderValue, voucherImage]
        );

        const voucherId = voucherResult.insertId;
        const message = `Bạn đã nhận được voucher ${voucherName}, ngày hết hạn: ${voucherDate}`;
        console.log("Adding notification for user:", userId, "Message:", message);
        await queryAsync(
            "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'voucher_received', ?, ?)",
            [userId, message, voucherId]
        ).catch(err => {
            console.error("❌ Error adding notification:", err.message);
        });

        // Lấy URL hình ảnh tương ứng với mức giảm giá
        const imageUrl = discountImages[result] || null;

        console.log("Result: Chúc mừng! Bạn nhận được voucher giảm", result, "%");
        res.json({ result: `Chúc mừng! Bạn nhận được voucher giảm ${result}%`, imageUrl: imageUrl });
    } catch (err) {
        console.error("❌ Error in POST /api/spin/spin/:userId:", err.message);
        res.status(500).json({ message: "Lỗi server", error: err.message });
    }
});

// Cron job: Thêm 1 lượt quay mỗi ngày lúc 3:00 AM (UTC+7)
cron.schedule('0 0 3 * * *', async () => {
    console.log("📅 Starting daily spin update");
    try {
        // Sửa từ SELECT user_id thành SELECT id
        const users = await queryAsync("SELECT id FROM users");
        if (!users?.length) {
            console.log("No users found");
            return;
        }

        console.log(`Processing ${users.length} users`);
        for (const user of users) {
            try {
                const userId = user.id; // Lấy id từ bảng users
                const spinRecord = await queryAsync("SELECT * FROM spin_attempts WHERE user_id = ?", [userId]);
                
                if (spinRecord.length === 0) {
                    await queryAsync(
                        "INSERT INTO spin_attempts (user_id, spin_count, last_updated, consecutive_no_reward) VALUES (?, 1, NOW(), 0)",
                        [userId]
                    );
                    console.log(`Created spin record for user ${userId}`);
                } else {
                    await queryAsync(
                        "UPDATE spin_attempts SET spin_count = spin_count + 1, last_updated = NOW() WHERE user_id = ?",
                        [userId]
                    );
                    console.log(`Updated spin count for user ${userId}`);
                }

                await queryAsync(
                    "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'spin_received', ?, NULL)",
                    [userId, "Bạn đã nhận được 1 lượt quay. Hãy quay ngay!"]
                );
                console.log(`Notified user ${userId}`);
            } catch (userError) {
                console.error(`Error processing user ${user.id}:`, userError.message);
            }
        }
        console.log("Daily spin update completed");
    } catch (err) {
        console.error("Critical error in daily spin update:", err.message);
    }
}, { timezone: 'Asia/Ho_Chi_Minh' });

module.exports = router;