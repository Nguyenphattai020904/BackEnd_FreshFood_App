const express = require("express");
const connection = require("../db");
const verifyToken = require("../middleware/auth");

const router = express.Router();

// Route để lấy danh sách sản phẩm
router.get("/order/products", (req, res) => {
    connection.query(
        "SELECT * FROM products",
        (err, results) => {
            if (err) {
                console.log("❌ Lỗi khi lấy danh sách sản phẩm:", err.message || err);
                return res.status(500).json({ message: "Lỗi server", error: err.message || err });
            }

            const products = results.map(product => ({
                product_id: product.product_id,
                name: product.name,
                price: product.price,
                discount: product.discount,
                final_price: product.final_price,
                quantity: product.quantity,
                images: product.images,
                nutrients: product.nutrients,
                brand: product.brand,
                category: product.category,
                ingredients: product.ingredients,
                main_category: product.main_category
            }));
            res.json({ products });
        }
    );
});

// Route để lấy danh sách Best Seller
router.get("/bestsellers", (req, res) => {
    console.log("Request headers:", req.headers); // In headers để kiểm tra
    console.log("Request user (if any):", req.user); // Kiểm tra xem middleware có thêm req.user không

    const query = `
        SELECT 
            oi.product_id,
            p.name,
            p.price,
            p.discount,
            p.final_price,
            p.quantity AS stock_quantity,
            p.images,
            p.nutrients,
            p.brand,
            p.category,
            p.ingredients,
            p.main_category,
            SUM(oi.quantity) AS total_sold
        FROM order_items oi
        JOIN products p ON oi.product_id = p.product_id
        GROUP BY oi.product_id, p.name, p.price, p.discount, p.final_price, p.quantity, p.images, p.nutrients, p.brand, p.category, p.ingredients, p.main_category
        ORDER BY total_sold DESC
        LIMIT 10
    `;

    console.log("Executing query:", query); // In truy vấn thực tế

    connection.query(query, (err, results) => {
        if (err) {
            console.log("❌ Lỗi khi lấy danh sách Best Seller:", err.message || err);
            return res.status(500).json({ message: "Lỗi server", error: err.message || err });
        }

        const bestSellers = results.map(product => ({
            product_id: product.product_id,
            name: product.name,
            price: product.price,
            discount: product.discount,
            final_price: product.final_price,
            quantity: product.stock_quantity,
            images: product.images,
            nutrients: product.nutrients,
            brand: product.brand,
            category: product.category,
            ingredients: product.ingredients,
            main_category: product.main_category,
            total_sold: product.total_sold
        }));

        res.json({ bestSellers });
    });
});

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
                discount: product.discount,
                final_price: product.final_price,
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

// Thêm sản phẩm
router.post("/order/products", (req, res) => {
    const { name, brand, price, quantity } = req.body;
    if (!name || !brand || !price || !quantity) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    connection.query(
        "INSERT INTO products (name, brand, price, final_price, quantity) VALUES (?, ?, ?, ?, ?)",
        [name, brand, price, price, quantity],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error adding product", error: err.message });
            res.json({ message: "Product added successfully", productId: results.insertId });
        }
    );
});

// Sửa sản phẩm
router.put("/:id", (req, res) => {
    const productId = req.params.id;
    const { name, brand, price, quantity } = req.body;

    connection.query(
        "UPDATE products SET name = ?, brand = ?, price = ?, final_price = ?, quantity = ? WHERE product_id = ?",
        [name, brand, price, price, quantity, productId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error updating product", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Product not found" });
            res.json({ message: "Product updated successfully" });
        }
    );
});

// Xóa sản phẩm
router.delete("/:id", (req, res) => {
    const productId = req.params.id;

    connection.query(
        "DELETE FROM products WHERE product_id = ?",
        [productId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error deleting product", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Product not found" });
            res.json({ message: "Product deleted successfully" });
        }
    );
});



module.exports = router;