const crypto = require("crypto");
const axios = require("axios");

const config = {
    app_id: "2554",
    key1: "sdngKKJmqEMzvh5QQcdD2A9XBSKUNaYn",
    key2: "trMrHtvjo6myautxDUiAcYsVtaeQ8nhf",
    endpoint: "https://sb-openapi.zalopay.vn/v2/create",
    query_endpoint: "https://sb-openapi.zalopay.vn/v2/query",
};

const createZaloPayOrder = async (amount, pendingOrderId, appTransId) => {
    const embed_data = JSON.stringify({ pendingOrderId });
    const items = JSON.stringify([]);
    const transId = appTransId;

    const order = {
        app_id: config.app_id,
        app_trans_id: transId,
        app_user: "test_user",
        app_time: Date.now(),
        item: items,
        embed_data: embed_data,
        amount: amount.toString(),
        description: `Thanh toán đơn hàng #${pendingOrderId}`,
        bank_code: "",
    };

    const data = `${config.app_id}|${order.app_trans_id}|${order.app_user}|${order.amount}|${order.app_time}|${order.embed_data}|${order.item}`;
    order.mac = crypto.createHmac("sha256", config.key1).update(data).digest("hex");

    console.log("Request to ZaloPay:", order);
    const encodedData = new URLSearchParams(order).toString();
    console.log("Encoded Data to ZaloPay:", encodedData);

    try {
        const response = await axios.post(config.endpoint, encodedData, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });
        console.log("Response from ZaloPay:", response.data);
        return response.data;
    } catch (error) {
        const errorDetail = error.response ? error.response.data : error.message;
        console.error("❌ ZaloPay error:", JSON.stringify(errorDetail, null, 2));
        throw errorDetail;
    }
};

const queryZaloPayOrder = async (appTransId) => {
    const params = {
        app_id: config.app_id,
        app_trans_id: appTransId,
    };

    const data = `${config.app_id}|${appTransId}|${config.key1}`;
    params.mac = crypto.createHmac("sha256", config.key1).update(data).digest("hex");

    console.log("Query ZaloPay Order:", params);

    try {
        const response = await axios.post(
            config.query_endpoint,
            new URLSearchParams(params).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );
        console.log("Query Response from ZaloPay:", response.data);
        return response.data;
    } catch (error) {
        const errorDetail = error.response ? error.response.data : error.message;
        console.error("❌ ZaloPay query error:", JSON.stringify(errorDetail, null, 2));
        throw errorDetail;
    }
};

module.exports = { createZaloPayOrder, queryZaloPayOrder, config };