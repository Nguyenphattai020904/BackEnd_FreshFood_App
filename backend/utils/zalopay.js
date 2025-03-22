const crypto = require("crypto");
const axios = require("axios");

const APP_ID = "554"; // Thay bằng app_id từ ZaloPay Sandbox
const KEY_1 = "8NdU5pG5R2spGHGhyO99HN1OhD8IQJBn"; // Thay bằng key1 từ ZaloPay Sandbox
const ENDPOINT = "https://sb-openapi.zalopay.vn/v2/create"; // Endpoint chính thức

async function createZaloPayOrder(amount, orderId) {
    const embed_data = { orderId }; // Gửi orderId để callback xử lý
    const items = [];
    const transID = `${new Date().toISOString().slice(2, 10).replace(/-/g, "")}_${Date.now()}`; // Ví dụ: 250320_123456789

    const order = {
        app_id: APP_ID,
        app_trans_id: transID, // Phải duy nhất cho mỗi giao dịch
        app_user: "test_user",
        app_time: Date.now(),
        amount: amount.toString(), // Chuỗi, số nguyên dương
        item: JSON.stringify(items),
        embed_data: JSON.stringify(embed_data),
        description: `Thanh toán đơn hàng #${orderId}`,
        bank_code: "", // Có thể để trống hoặc chọn bank_code nếu cần
    };

    // Tạo MAC
    const data = `${order.app_id}|${order.app_trans_id}|${order.app_user}|${order.amount}|${order.app_time}|${order.embed_data}|${order.item}`;
    order.mac = crypto.createHmac("sha256", KEY_1).update(data).digest("hex");

    console.log("Request to ZaloPay:", order); // Log dữ liệu gửi đi

    try {
        const response = await axios.post(ENDPOINT, new URLSearchParams(order).toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });
        console.log("Response from ZaloPay:", response.data); // Log phản hồi
        return response.data;
    } catch (error) {
        const errorDetail = error.response ? error.response.data : error.message;
        console.error("ZaloPay API Error:", errorDetail); // Log lỗi chi tiết
        return { return_code: -1, return_message: "Lỗi khi gọi ZaloPay API", error: errorDetail };
    }
}

module.exports = { createZaloPayOrder };