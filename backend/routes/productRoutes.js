const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");

const router = express.Router();

// Route để lấy chi tiết sản phẩm theo ID
router.get("/:id", verifyToken, (req, res) => {
    const productId = parseInt(req.params.id);

    connection.query(
        "SELECT * FROM products WHERE product_id = ?",
        [productId],
        (err, results) => {
            if (err) {
                console.log("❌ Lỗi khi lấy chi tiết sản phẩm:", err.message || err);
                return res.status(500).json({ message: "Lỗi server", error: err.message || err });
            }

            if (results.length === 0) {
                console.log(`❌ Sản phẩm với product_id: ${productId} không tồn tại`);
                return res.status(404).json({ message: "Sản phẩm không tồn tại" });
            }

            const product = results[0];
            res.json({
                product_id: product.product_id,
                name: product.name,
                price: product.price,
                quantity: product.quantity,
                images: product.images,
                nutrients: product.nutrients,
                brand: product.brand,
                category: product.category,
                ingredients: product.ingredients,
                main_category: product.main_category
            });
        }
    );
});

module.exports = router;