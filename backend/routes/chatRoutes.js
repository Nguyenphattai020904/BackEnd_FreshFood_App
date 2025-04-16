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

(async () => {
    const { default: PQueue } = await import("p-queue");
    geminiQueue = new PQueue({
        concurrency: 1,
        intervalCap: 1,
        interval: 2000,
    });
})();

// Cấu hình axios-retry
axiosRetry(axios, {
    retries: 5,
    retryDelay: (retryCount, error) => {
        const retryAfter = error.response?.headers["retry-after"] || retryCount * 10;
        console.log(`⏳ Chờ ${retryAfter} giây trước khi thử lại...`);
        return retryAfter * 1000;
    },
    retryCondition: (error) => error.response?.status === 429,
});

// Cấu hình rate limiting
const askAiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user.id,
    message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.",
});

// Hàm loại bỏ dấu tiếng Việt
const removeAccents = (str) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
};

// 🔹 Danh sách từ khóa kích hoạt
const triggerKeywords = [
    "danh sách", "hãy lấy", "lấy cho tui", "lấy", "muốn", "nguyên liệu", "công thức",
    "cho tui", "tìm", "có những", "liệt kê", "gợi ý", "đề xuất", "cần", "tìm kiếm",
    "món ăn", "thực phẩm", "sản phẩm", "dinh dưỡng", "ăn uống", "chế độ ăn", "giảm giá",
    "số lượng", "còn bao nhiêu", "tồn kho", "còn lại", "đặc sản", "nổi tiếng", "đặc trưng"
];

// 🔹 Danh sách validTopics
let validTopics = [
    "ăn uống", "món ăn", "công thức", "dinh dưỡng", "thực phẩm", "nguyên liệu", "ăn kiêng",
    "chế độ ăn", "sức khỏe", "giảm cân", "tăng cân", "protein", "vitamin", "keto", "low-carb",
    "ăn chay", "đồ uống", "bữa ăn", "chất béo", "carbs", "đường", "ăn vặt", "bữa sáng",
    "bữa trưa", "bữa tối", "tráng miệng", "nước ép", "sinh tố", "thức ăn", "đồ ăn", "mặt hàng",
    "sản phẩm", "thịt", "cá", "rau", "trái cây", "sữa", "phô mai", "bánh mì", "gạo", "mì",
    "gia vị", "dầu ăn", "nước chấm", "thức uống", "trà", "cà phê", "năng lượng", "cholesterol",
    "đạm", "khoáng chất", "chất xơ", "healthy", "lành mạnh", "tập luyện", "thể dục", "béo phì",
    "tiểu đường", "kế hoạch", "nghèo", "ít tiền", "giá rẻ", "thực phẩm giá rẻ", "thực phẩm tiết kiệm",
    "thực phẩm bình dân", "thực phẩm hữu cơ", "thực phẩm sạch", "thực phẩm an toàn", "thực phẩm tươi sống",
    "thực phẩm chế biến sẵn", "thực phẩm dinh dưỡng", "thực phẩm bổ sung", "thực phẩm chức năng",
    "thực phẩm tiện lợi", "thực phẩm nhanh chóng", "thực phẩm dễ chế biến", "thực phẩm dễ ăn",
    "thực phẩm ngon miệng", "thực phẩm hấp dẫn", "thực phẩm bổ dưỡng", "cảm cúm", "sốt", "đãi tiệc",
    "sinh nhật", "mừng tuổi", "mừng thọ", "bún bò", "phở", "cơm tấm", "bánh mì", "hủ tiếu", "bánh xèo",
    "gỏi cuốn", "chả giò", "bánh tráng", "bánh bao", "bánh bột lọc", "bánh bèo", "bánh đúc", "bánh chưng",
    "bánh tét", "bánh trung thu", "bánh kem", "bánh sinh nhật", "đặc sản", "nổi tiếng", "đặc trưng",
    // Tiếng Anh
    "food", "nutrition", "health", "diet", "calories", "protein", "vitamins", "low-carb", "keto",
    "vegan", "vegetarian", "drink", "beverage", "meal", "breakfast", "lunch", "dinner", "snack",
    "dessert", "juice", "smoothie", "ingredient", "recipe", "fat", "carbs", "sugar", "meat", "fish",
    "vegetable", "fruit", "milk", "cheese", "bread", "rice", "noodle", "spice", "oil", "sauce",
    "tea", "coffee", "energy", "cholesterol", "fiber", "mineral", "weight loss", "weight gain",
    "healthy", "exercise", "fitness", "obesity", "diabetes", "product", "item", "groceries"
];

// 🔹 Thông tin đặc sản
const specialtyInfo = {
    "toi ly son": "Tỏi Lý Sơn nổi tiếng với hương vị đậm đà, cay nồng, được trồng trên đất núi lửa ở đảo Lý Sơn, Quảng Ngãi.",
    "xoai cat hoa loc": "Xoài Cát Hòa Lộc có vị ngọt thanh, thịt chắc, thơm, là đặc sản nổi tiếng của Tiền Giang.",
    "nhan long hung yen": "Nhãn Lồng Hưng Yên ngọt đậm, cùi dày, hạt nhỏ, được xem là loại nhãn ngon nhất Việt Nam.",
    "que tra bong": "Quế Trà Bồng từ Quảng Ngãi có mùi thơm nồng, tinh dầu cao, được dùng trong ẩm thực và y học.",
    "vu sua lo ren": "Vú Sữa Lò Rèn ở Vĩnh Kim, Tiền Giang, ngọt thanh, mềm mịn, là trái cây đặc sản miền Tây.",
    "vai thieu luc ngan": "Vải Thiều Lục Ngạn, Bắc Giang, có vị ngọt đậm, mọng nước, là loại vải nổi tiếng cả nước.",
    "chanh day lam dong": "Chanh Dây Lâm Đồng chua dịu, thơm, giàu vitamin C, là đặc sản vùng cao nguyên.",
    "muoi tay ninh": "Muối Tây Ninh, đặc biệt là muối tôm, có vị mặn, cay, thơm, dùng để chấm trái cây.",
    "ca phe buon me thuot": "Cà Phê Buôn Mê Thuột đậm đà, thơm nồng, là biểu tượng cà phê Việt Nam từ Đắk Lắk.",
    "ho tieu phu quoc": "Hồ Tiêu Phú Quốc cay nồng, thơm đặc trưng, được trồng trên đảo ngọc Kiên Giang.",
};

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

// Hàm định dạng câu trả lời từ AI
function formatAiResponse(answer) {
    // Thay thế nhiều ký tự xuống dòng thừa
    answer = answer.replace(/\n\s*\n+/g, "\n\n");

    // Chuyển các dòng bắt đầu bằng số hoặc ký tự đặc biệt thành danh sách
    const lines = answer.split("\n");
    let formattedLines = [];
    let inList = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // Kiểm tra nếu là mục danh sách (bắt đầu bằng số, -, *, hoặc •)
        if (line.match(/^\d+\.\s|^[\-\*•]\s/)) {
            if (!inList) {
                inList = true;
            }
            // Chuẩn hóa thành ký tự gạch đầu dòng
            line = line.replace(/^\d+\.\s|^[\-\*•]\s/, "- ");
            formattedLines.push(line);
        } else {
            if (inList) {
                inList = false;
            }
            formattedLines.push(line);
        }
    }

    // Thêm xuống dòng giữa các đoạn
    return formattedLines.join("\n");
}

// Hàm kiểm tra số lượng tồn kho thấp
const checkLowInventory = (quantity) => {
    const LOW_INVENTORY_THRESHOLD = 10; // Ngưỡng cảnh báo tồn kho thấp
    return quantity <= LOW_INVENTORY_THRESHOLD 
        ? ` (Cảnh báo: Số lượng thấp, chỉ còn ${quantity} đơn vị!)` 
        : ` (${quantity} đơn vị)`;
};

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
            "SELECT product_id, name, images, nutrients, price, brand, category, ingredients, main_category, quantity FROM products",
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
                        quantity: product.quantity,
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
                            quantity: productData.quantity,
                            detailLink: `/products/${productData.product_id}`
                        });
                    }
                }

                let responseToCache;

                // Xử lý câu hỏi về số lượng
                if (
                    normalizedPrompt.includes("so luong") || 
                    normalizedPrompt.includes("con bao nhieu") || 
                    normalizedPrompt.includes("ton kho") ||
                    normalizedPrompt.includes("con lai")
                ) {
                    let answer = "";
                    let mentionedProducts = [];

                    // Xử lý câu hỏi về tất cả sản phẩm nếu không đề cập sản phẩm cụ thể
                    if (mentionedProductsInPrompt.length === 0 && normalizedPrompt.includes("tat ca")) {
                        const lowInventoryProducts = results
                            .filter(product => product.quantity < 20) // Lọc sản phẩm có tồn kho < 20
                            .slice(0, 5) // Giới hạn 5 sản phẩm
                            .map(product => {
                                let imageUrl = product.images;
                                try {
                                    if (imageUrl && imageUrl.startsWith("[")) {
                                        const imagesArray = JSON.parse(imageUrl);
                                        imageUrl = imagesArray.length > 0 ? imagesArray[0] : null;
                                    }
                                } catch (error) {
                                    imageUrl = null;
                                }
                                return {
                                    name: product.name,
                                    product_id: product.product_id,
                                    images: imageUrl,
                                    price: product.price,
                                    quantity: product.quantity,
                                    detailLink: `/products/${product.product_id}`
                                };
                            });

                        if (lowInventoryProducts.length > 0) {
                            answer = "Số lượng tồn kho của các sản phẩm (mẫu):\n" + 
                                lowInventoryProducts
                                    .map(p => `- ${p.name}: ${checkLowInventory(p.quantity)} (Giá: ${p.price} VNĐ)`)
                                    .join("\n");
                            mentionedProducts = lowInventoryProducts;
                        } else {
                            answer = "Tất cả sản phẩm hiện tại đều có số lượng tồn kho đủ (trên 20 đơn vị).";
                        }
                    } else if (mentionedProductsInPrompt.length > 0) {
                        // Xử lý câu hỏi về sản phẩm cụ thể
                        mentionedProducts = mentionedProductsInPrompt.map(product => ({
                            name: product.name,
                            product_id: product.product_id,
                            images: product.images,
                            price: product.price,
                            quantity: product.quantity,
                            detailLink: `/products/${product.product_id}`
                        }));
                        answer = mentionedProducts
                            .map(p => `Số lượng ${p.name} còn ${checkLowInventory(p.quantity)} (Giá: ${p.price} VNĐ).`)
                            .join("\n");
                    } else {
                        answer = "Không tìm thấy sản phẩm trong câu hỏi. Vui lòng chỉ rõ tên sản phẩm hoặc hỏi về tất cả sản phẩm (ví dụ: 'tồn kho tất cả').";
                    }

                    responseToCache = {
                        success: true,
                        userPrompt,
                        answer,
                        mentionedProducts: mentionedProducts.length > 0 ? mentionedProducts : null
                    };

                    cache.put(cacheKey, responseToCache, 3600 * 1000);
                    console.log("✅ Cached response for key:", cacheKey);
                    connection.query(
                        "INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)",
                        [userId, userPrompt, answer],
                        (err) => {
                            if (err) console.log("❌ Lỗi khi lưu lịch sử chat:", err.message || err);
                        }
                    );
                    return res.json(responseToCache);
                }

                // Xử lý câu hỏi về đặc sản
                if (normalizedPrompt.includes("dac san") || normalizedPrompt.includes("noi tieng") || normalizedPrompt.includes("dac trung")) {
                    if (mentionedProductsInPrompt.length > 0) {
                        const product = mentionedProductsInPrompt[0];
                        const specialtyDescription = specialtyInfo[removeAccents(product.name.toLowerCase())] || 
                            `${product.name} là một đặc sản của ${product.brand}, thuộc loại ${product.main_category}.`;
                        const answer = specialtyDescription;
                        responseToCache = {
                            success: true,
                            userPrompt,
                            answer,
                            mentionedProducts: [product]
                        };
                        cache.put(cacheKey, responseToCache, 3600 * 1000);
                        console.log("✅ Cached response for key:", cacheKey);
                        connection.query(
                            "INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)",
                            [userId, userPrompt, answer],
                            (err) => {
                                if (err) console.log("❌ Lỗi khi lưu lịch sử chat:", err.message || err);
                            }
                        );
                        return res.json(responseToCache);
                    } else {
                        const specialtyProducts = results
                            .filter(p => p.main_category === "Đặc Sản Việt")
                            .map(p => p.name)
                            .slice(0, 3)
                            .join(", ");
                        const answer = `Một số đặc sản Việt Nam nổi tiếng:\n- ${specialtyProducts.replace(/, /g, "\n- ")}.\nBạn muốn biết thêm về đặc sản nào?`;
                        responseToCache = {
                            success: true,
                            userPrompt,
                            answer,
                            mentionedProducts: null
                        };
                        cache.put(cacheKey, responseToCache, 3600 * 1000);
                        console.log("✅ Cached response for key:", cacheKey);
                        connection.query(
                            "INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)",
                            [userId, userPrompt, answer],
                            (err) => {
                                if (err) console.log("❌ Lỗi khi lưu lịch sử chat:", err.message || err);
                            }
                        );
                        return res.json(responseToCache);
                    }
                }

                // Xử lý các câu hỏi khác với AI
                let aiPrompt = responseLanguage === "en"
                    ? `Available products: ${productList}. User asked: "${userPrompt}". Answer concisely in English, under 100 words, mentioning specific products if relevant. Use bullet points for lists and separate paragraphs with newlines.`
                    : `Danh sách sản phẩm có sẵn: ${productList}. Người dùng hỏi: "${userPrompt}". Trả lời ngắn gọn bằng tiếng Việt, dưới 100 từ, đề cập sản phẩm cụ thể nếu liên quan. Sử dụng dấu đầu dòng (-) cho danh sách và xuống dòng giữa các đoạn.`;

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

                    let answer = aiResponse.data.candidates[0]?.content?.parts[0]?.text || "Không tìm thấy câu trả lời.";
                    console.log("📝 AI response before formatting:", answer);
                    answer = formatAiResponse(answer);
                    const cleanedAnswer = answer.replace(/\*+/g, "");
                    console.log("📝 AI response after formatting:", cleanedAnswer);

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
                                category: productData.category | "Không xác định",
                                ingredients: productData.ingredients,
                                main_category: productData.main_category,
                                quantity: productData.quantity,
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

                    responseToCache = {
                        success: true,
                        userPrompt,
                        answer: cleanedAnswer,
                        mentionedProducts: mentionedProducts.length > 0 ? mentionedProducts : null
                    };

                    cache.put(cacheKey, responseToCache, 3600 * 1000);
                    console.log("✅ Cached response for key:", cacheKey);

                    res.json(responseToCache);
                } catch (error) {
                    console.log("❌ Lỗi khi gọi Gemini API:", error.message || error);
                    res.status(500).json({ success: false, message: "Lỗi khi gọi AI", error: error.message || error });
                }
            }
        );
    } catch (error) {
        console.log("❌ Lỗi server:", error);
        res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
    }
});

module.exports = router;