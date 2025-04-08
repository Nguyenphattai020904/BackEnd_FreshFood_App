const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const rateLimit = require("express-rate-limit");
const cache = require("memory-cache");
require("dotenv").config();

const router = express.Router();

// Khởi tạo PQueue bất đồng bộ
let geminiQueue;

// Hàm khởi tạo queue
(async () => {
    const { default: PQueue } = await import("p-queue");
    geminiQueue = new PQueue({
        concurrency: 1,
        intervalCap: 1,
        interval: 2000, // Tăng lên 2 giây
    });
})();

// Cấu hình axios-retry để thử lại khi gặp lỗi 429
axiosRetry(axios, {
    retries: 5, // Tăng số lần thử lại
    retryDelay: (retryCount, error) => {
        const retryAfter = error.response?.headers["retry-after"] || retryCount * 10; // Mặc định 10 giây
        console.log(`⏳ Chờ ${retryAfter} giây trước khi thử lại...`);
        return retryAfter * 1000;
    },
    retryCondition: (error) => error.response?.status === 429,
});

// Cấu hình rate limiting cho endpoint /ask-ai
const askAiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user.id,
    message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.",
});

// Thêm endpoint /api/ping để kiểm tra mạng
router.get("/api/ping", (req, res) => {
    res.status(200).json({ success: true, message: "Server is alive" });
});

// Hàm loại bỏ dấu tiếng Việt
const removeAccents = (str) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
};

// 🔹 Danh sách từ khóa để kích hoạt hiển thị sản phẩm
const triggerKeywords = [
    "danh sách", "hãy lấy", "lấy cho tui", "lấy", "muốn", "nguyên liệu", "công thức",
    "cho tui", "tìm", "có những", "liệt kê", "gợi ý", "đề xuất", "cần", "tìm kiếm",
    "món ăn", "thực phẩm", "sản phẩm", "dinh dưỡng", "ăn uống", "chế độ ăn", "giảm giá", "công thức"
];

// 🔹 Lấy danh sách sản phẩm từ database để thêm vào validTopics
let validTopics = [
    // Tiếng Việt
    "ăn uống", "món ăn", "công thức", "dinh dưỡng", "thực phẩm", 
    "nguyên liệu", "ăn kiêng", "chế độ ăn", "sức khỏe", "giảm cân", 
    "tăng cân", "protein", "vitamin", "keto", "low-carb", "ăn chay", 
    "đồ uống", "bữa ăn", "chất béo", "carbs", "đường", "ăn vặt", 
    "bữa sáng", "bữa trưa", "bữa tối", "tráng miệng", "nước ép", 
    "sinh tố", "thức ăn", "đồ ăn", "mặt hàng", "sản phẩm", "thịt", 
    "cá", "rau", "trái cây", "sữa", "phô mai", "bánh mì", "gạo", 
    "mì", "gia vị", "dầu ăn", "nước chấm", "thức uống", "trà", "cà phê", 
    "năng lượng", "cholesterol", "đạm", "khoáng chất", "chất xơ", 
    "healthy", "lành mạnh", "tập luyện", "thể dục", "béo phì", "tiểu đường", "kế hoạchhoạch", "nghèo", "ít tiền", "giá rẻ", "thực phẩm giá rẻ", "thực phẩm tiết kiệm", "thực phẩm bình dân",
    "thực phẩm hữu cơ", "thực phẩm sạch", "thực phẩm an toàn", "thực phẩm tươi sống", "thực phẩm chế biến sẵn", "thực phẩm dinh dưỡng", "thực phẩm bổ sung", "thực phẩm chức năng", "thực phẩm tiện lợi", "thực phẩm nhanh chóng", "thực phẩm dễ chế biến", "thực phẩm dễ ăn", "thực phẩm ngon miệng", "thực phẩm hấp dẫn", "thực phẩm bổ dưỡng", "cảm cúm", "sốt", "đãi tiệc", "sinh nhật", "mừng tuổi", "mừng thọ", "bún bò", "phở", "cơm tấm", "bánh mì", "hủ tiếu", "bánh xèo", "gỏi cuốn", "chả giò", "bánh tráng", "bánh bao", "bánh bột lọc", "bánh bèo", "bánh đúc", "bánh chưng", "bánh tét", "bánh trung thu", "bánh kem", "bánh sinh nhật",

    // Tiếng Anh
    "food", "nutrition", "health", "diet", "calories", "protein", 
    "vitamins", "low-carb", "keto", "vegan", "vegetarian", "drink", 
    "beverage", "meal", "breakfast", "lunch", "dinner", "snack", 
    "dessert", "juice", "smoothie", "ingredient", "recipe", "fat", 
    "carbs", "sugar", "meat", "fish", "vegetable", "fruit", "milk", 
    "cheese", "bread", "rice", "noodle", "spice", "oil", "sauce", 
    "tea", "coffee", "energy", "cholesterol", "fiber", "mineral", 
    "weight loss", "weight gain", "healthy", "exercise", "fitness", 
    "obesity", "diabetes", "product", "item", "groceries"
];

// 🔹 Lấy tên sản phẩm từ bảng products và thêm vào validTopics
connection.query("SELECT name FROM products", (err, results) => {
    if (err) {
        console.log("❌ Lỗi khi lấy danh sách sản phẩm cho validTopics:", err.message || err);
        return;
    }

    const productNames = results.map(product => product.name.toLowerCase());
    validTopics = [...validTopics, ...productNames].map(topic => removeAccents(topic.toLowerCase()));
    console.log("✅ Đã thêm tên sản phẩm vào validTopics:", productNames);
});

// API xử lý câu hỏi về thực phẩm
router.post("/ask-ai", verifyToken, askAiLimiter, async (req, res) => {
    console.log(`📩 Nhận request từ user ${req.user.id}: ${req.body.userPrompt}`);
    let { userPrompt } = req.body;
    const userId = req.user.id;

    if (!userPrompt) {
        return res.status(400).json({ message: "Thiếu userPrompt" });
    }

    userPrompt = userPrompt.trim();
    const normalizedPrompt = removeAccents(userPrompt.toLowerCase());
    let responseLanguage = "vi"; // Mặc định trả lời tiếng Việt

    const isVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/.test(userPrompt);
    if (!isVietnamese) {
        responseLanguage = "en";
    }

    const isValidTopic = validTopics.some(topic => normalizedPrompt.includes(topic));
    if (!isValidTopic) {
        return res.status(400).json({ message: "Chỉ hỗ trợ câu hỏi về thực phẩm, sức khỏe, dinh dưỡng hoặc sản phẩm!" });
    }

    const cacheKey = `ai_response:${userPrompt.trim().toLowerCase()}`;
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) {
        console.log("✅ Cache hit for key:", cacheKey);
        return res.json(cachedResponse);
    } else {
        console.log("❌ Cache miss for key:", cacheKey);
    }

    try {
        connection.query(
            "SELECT product_id, name, images, nutrients, price, brand, category, ingredients, main_category FROM products",
            async (err, results) => {
                if (err) {
                    console.log("❌ Database error:", err.message || err);
                    return res.status(500).json({ message: "Lỗi database", error: err.message || err });
                }

                const productList = results.map((product) => product.name).join(", ");
                const productsWithDetails = results.reduce((acc, product) => {
                    let imageUrl = product.images;
                    try {
                        if (imageUrl && imageUrl.startsWith("[")) {
                            const imagesArray = JSON.parse(imageUrl);
                            imageUrl = imagesArray.length > 0 ? imagesArray[0] : null;
                        }
                    } catch (error) {
                        imageUrl = null;
                    }

                    acc[removeAccents(product.name.toLowerCase())] = {
                        product_id: product.product_id,
                        images: imageUrl,
                        nutrients: product.nutrients,
                        price: product.price,
                        brand: product.brand,
                        category: product.category,
                        ingredients: product.ingredients,
                        main_category: product.main_category,
                        originalName: product.name
                    };
                    return acc;
                }, {});

                const promptWords = normalizedPrompt.split(" ");
                const mentionedProductsInPrompt = [];
                for (const productName in productsWithDetails) {
                    const normalizedProductName = productName.split(" ");
                    const matchingWords = normalizedProductName.filter(word => promptWords.includes(word));
                    if (matchingWords.length >= 2 || normalizedPrompt.includes(productName)) {
                        const productData = productsWithDetails[productName];
                        mentionedProductsInPrompt.push({
                            name: productData.originalName,
                            product_id: productData.product_id,
                            images: productData.images,
                            nutrients: productData.nutrients,
                            price: productData.price,
                            brand: productData.brand,
                            category: productData.category,
                            ingredients: productData.ingredients,
                            main_category: productData.main_category,
                            detailLink: `/products/${productData.product_id}`
                        });
                    }
                }

                let aiPrompt = responseLanguage === "en"
                    ? `Available products: ${productList}. User asked: "${userPrompt}". Answer concisely in English, under 100 words, mentioning specific products if relevant.`
                    : `Danh sách sản phẩm có sẵn: ${productList}. Người dùng hỏi: "${userPrompt}". Trả lời ngắn gọn bằng tiếng Việt, dưới 100 từ, đề cập sản phẩm cụ thể nếu liên quan.`;

                try {
                    const aiResponse = await geminiQueue.add(() =>
                        axios.post(
                            "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent",
                            {
                                contents: [{ role: "user", parts: [{ text: aiPrompt }] }]
                            },
                            {
                                headers: { "Content-Type": "application/json" },
                                params: { key: process.env.GEMINI_API_KEY },
                            }
                        )
                    );

                    const answer = aiResponse.data.candidates[0]?.content?.parts[0]?.text || "Không tìm thấy câu trả lời.";
                    const cleanedAnswer = answer.replace(/\*/g, "");
                    const normalizedAnswer = removeAccents(cleanedAnswer.toLowerCase());
                    const answerWords = normalizedAnswer.split(" ");

                    const mentionedProductsInAnswer = [];
                    for (const productName in productsWithDetails) {
                        const normalizedProductName = productName.split(" ");
                        const matchingWords = normalizedProductName.filter(word => answerWords.includes(word));
                        if (matchingWords.length >= 2 || normalizedAnswer.includes(productName)) {
                            const productData = productsWithDetails[productName];
                            mentionedProductsInAnswer.push({
                                name: productData.originalName,
                                product_id: productData.product_id,
                                images: productData.images,
                                nutrients: productData.nutrients,
                                price: productData.price,
                                brand: productData.brand,
                                category: productData.category,
                                ingredients: productData.ingredients,
                                main_category: productData.main_category,
                                detailLink: `/products/${productData.product_id}`
                            });
                        }
                    }

                    let mentionedProducts = [...mentionedProductsInPrompt, ...mentionedProductsInAnswer];
                    mentionedProducts = mentionedProducts.filter(
                        (product, index, self) =>
                            index === self.findIndex(p => p.product_id === product.product_id)
                    );

                    mentionedProducts = mentionedProducts.filter(product => {
                        const normalizedProductName = removeAccents(product.name.toLowerCase());
                        return normalizedPrompt.includes(normalizedProductName) || normalizedAnswer.includes(normalizedProductName);
                    });

                    connection.query(
                        "INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)",
                        [userId, userPrompt, cleanedAnswer],
                        (err) => {
                            if (err) console.log("❌ Lỗi khi lưu lịch sử chat:", err.message || err);
                        }
                    );

                    const responseToCache = {
                        success: true,
                        userPrompt,
                        answer: cleanedAnswer,
                        mentionedProducts: mentionedProducts.length > 0 ? mentionedProducts : null
                    };

                    cache.put(cacheKey, responseToCache, 3600 * 1000);
                    console.log("✅ Cached response for key:", cacheKey);

                    res.json(responseToCache);
                } catch (error) {
                    // ... (giữ nguyên xử lý lỗi)
                }
            }
        );
    }catch (error) {
        console.log("❌ Lỗi server:", error);
        res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
    }
});

module.exports = router;