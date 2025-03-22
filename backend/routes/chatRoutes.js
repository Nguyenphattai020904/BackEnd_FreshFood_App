const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();

// Danh sách từ khóa liên quan đến thực phẩm, sức khỏe, dinh dưỡng, mặt hàng
const validTopics = [
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
    "healthy", "lành mạnh", "tập luyện", "thể dục", "béo phì", "tiểu đường",

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
].map(topic => topic.toLowerCase());

// Hàm loại bỏ dấu tiếng Việt
const removeAccents = (str) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
};

// API xử lý câu hỏi về thực phẩm
router.post("/ask-ai", verifyToken, async (req, res) => {
    let { userPrompt } = req.body;
    const userId = req.user.id;

    if (!userPrompt) {
        return res.status(400).json({ message: "Thiếu userPrompt" });
    }

    userPrompt = userPrompt.trim();
    const normalizedPrompt = removeAccents(userPrompt.toLowerCase());
    let responseLanguage = "vi"; // Mặc định trả lời tiếng Việt

    // 🔹 Xác định ngôn ngữ của câu hỏi (Việt hay Anh)
    const isVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/.test(userPrompt);
    if (!isVietnamese) {
        responseLanguage = "en"; // Nếu không có ký tự tiếng Việt, giả định là tiếng Anh
    }

    // 🔹 Kiểm tra câu hỏi có liên quan đến thực phẩm không (Hỗ trợ cả tiếng Anh)
    const isValidTopic = validTopics.some(topic => normalizedPrompt.includes(removeAccents(topic)));
    if (!isValidTopic) {
        return res.status(400).json({ message: "Chỉ hỗ trợ câu hỏi về thực phẩm, sức khỏe, dinh dưỡng!" });
    }

    try {
        // 🔹 Lấy danh sách **10 sản phẩm đầu tiên** để tối ưu
        connection.query("SELECT name FROM products LIMIT 10", async (err, results) => {
            if (err) {
                console.log("❌ Database error:", err.sqlMessage);
                return res.status(500).json({ message: "Lỗi database", error: err.sqlMessage });
            }

            // Chuyển danh sách sản phẩm thành chuỗi
            const productList = results.map((product) => product.name).join(", ");
            
            // 🔹 Tạo prompt gửi đến AI (Rút gọn câu trả lời tối đa 100 từ)
            let aiPrompt = responseLanguage === "en"
                ? `Available products: ${productList}. User asked: "${userPrompt}". Answer concisely in English, under 100 words.`
                : `Danh sách sản phẩm có sẵn: ${productList}. Người dùng hỏi: "${userPrompt}". Trả lời ngắn gọn bằng tiếng Việt, dưới 100 từ.`;

            try {
                const aiResponse = await axios.post(
                    "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent",
                    {
                        contents: [{ role: "user", parts: [{ text: aiPrompt }] }]
                    },
                    {
                        headers: { "Content-Type": "application/json" },
                        params: { key: process.env.GEMINI_API_KEY },
                    }
                );

                const answer = aiResponse.data.candidates[0]?.content?.parts[0]?.text || "Không tìm thấy câu trả lời.";
                const cleanedAnswer = answer.replace(/\*/g, ""); // Xóa dấu * để tránh mất thẩm mỹ

                // 🔹 Lưu lịch sử chat vào database
                connection.query(
                    "INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)",
                    [userId, userPrompt, cleanedAnswer],
                    (err) => {
                        if (err) console.log("❌ Lỗi khi lưu lịch sử chat:", err.sqlMessage);
                    }
                );

                res.json({ userPrompt, answer: cleanedAnswer });
            } catch (error) {
                console.log("❌ Lỗi AI Gemini:", error.message);
                res.status(500).json({ message: "Lỗi AI", error: error.message });
            }
        });
    } catch (error) {
        console.log("❌ Lỗi server:", error);
        res.status(500).json({ message: "Lỗi server", error: error.message });
    }
});

module.exports = router;