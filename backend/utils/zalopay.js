const crypto = require("crypto");
const axios = require("axios");

const config = {
    app_id: "2554",
    key1: "sdngKKJmqEMzvh5QQcdD2A9XBSKUNaYn",
    key2: "trMrHtvjo6myautxDUiAcYsVtaeQ8nhf",
    endpoint_create: "https://sb-openapi.zalopay.vn/v2/create",
    endpoint_query: "https://sb-openapi.zalopay.vn/v2/query",
    callback_url: "https://d7b0-113-161-85-254.ngrok-free.app/order/zalopay-callback" 
};

const createZaloPayOrder = async (amount, pendingOrderId, appTransId) => {
    const timestamp = Date.now();
    const order = {
        app_id: config.app_id,
        app_trans_id: appTransId,
        app_user: "sandbox_user",
        app_time: timestamp,
        amount: Math.round(amount),
        item: "[]",
        embed_data: JSON.stringify({ pendingOrderId: pendingOrderId }),
        description: `Thanh toán đơn hàng #${pendingOrderId} (Sandbox)`,
        bank_code: "",
        callback_url: config.callback_url,
        redirect_url: "finalproject://payment?orderId=" + pendingOrderId
    };

    const data = `${order.app_id}|${order.app_trans_id}|${order.app_user}|${order.amount}|${order.app_time}|${order.embed_data}|${order.item}`;
    order.mac = crypto.createHmac("sha256", config.key1)
        .update(data)
        .digest("hex");

    console.log("Request to ZaloPay:", order);

    try {
        const response = await axios.post(config.endpoint_create, new URLSearchParams(order).toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        console.log("ZaloPay Response:", response.data);
        return response.data;
    } catch (error) {
        console.error("ZaloPay Error:", error.response?.data || error.message);
        throw error.response?.data || error;
    }
};

const queryZaloPayOrder = async (appTransId) => {
    const timestamp = Date.now();
    const query = {
        app_id: config.app_id,
        app_trans_id: appTransId,
        req_date: timestamp
    };

    const data = `${query.app_id}|${query.app_trans_id}|${query.req_date}`;
    console.log("Data string for MAC:", data);
    console.log("Using key2:", config.key2);
    const mac = crypto.createHmac("sha256", config.key2).update(data).digest("hex");
    query.mac = mac;
    console.log("Generated MAC:", mac);

    const queryString = new URLSearchParams(query).toString();
    console.log("Full query string sent to ZaloPay:", queryString);

    try {
        const response = await axios.post(config.endpoint_query, queryString, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        console.log("ZaloPay Query Response:", JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.error("ZaloPay Query Error:", JSON.stringify(error.response?.data || error.message, null, 2));
        return { return_code: 0, return_message: "Query failed", error: error.response?.data || error.message };
    }
};

module.exports = { createZaloPayOrder, queryZaloPayOrder, config };