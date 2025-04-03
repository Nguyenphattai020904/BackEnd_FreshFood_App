const express = require("express");
const axios = require("axios");
const router = express.Router();
const connection = require("../db");

// Lấy danh sách tỉnh
router.get("/provinces", async (req, res) => {
    try {
        const response = await axios.get("https://provinces.open-api.vn/api/p/");
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ message: "Error fetching provinces", error: error.message });
    }
});

// Lấy danh sách huyện của một tỉnh
router.get("/districts/:provinceCode", async (req, res) => {
    try {
        const { provinceCode } = req.params;
        const response = await axios.get(`https://provinces.open-api.vn/api/p/${provinceCode}?depth=2`);
        res.json(response.data.districts);
    } catch (error) {
        res.status(500).json({ message: "Error fetching districts", error: error.message });
    }
});

// Lấy danh sách xã của một huyện
router.get("/wards/:districtCode", async (req, res) => {
    try {
        const { districtCode } = req.params;
        const response = await axios.get(`https://provinces.open-api.vn/api/d/${districtCode}?depth=2`);
        res.json(response.data.wards);
    } catch (error) {
        res.status(500).json({ message: "Error fetching wards", error: error.message });
    }
});

// Lấy danh sách địa chỉ của người dùng
router.get("/user/:userId", (req, res) => {
    const { userId } = req.params;
    connection.query("SELECT * FROM address WHERE user_id = ?", [userId], (error, results) => {
        if (error) {
            console.error("Query error:", error);
            return res.status(500).json({ message: "Error fetching addresses", error: error.message });
        }
        console.log("Fetched addresses:", results);
        res.json(results);
    });
});

// Lưu địa chỉ mới
router.post("/save", (req, res) => {
    const { user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address } = req.body;
    if (!user_id || !province_name || !district_name || !ward_name || !street_address) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    connection.query(
        "INSERT INTO address (user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, province_code || null, province_name, district_code || null, district_name, ward_code || null, ward_name, street_address],
        (error, results) => {
            if (error) {
                console.error("Query error:", error);
                return res.status(500).json({ message: "Error saving address", error: error.message });
            }
            console.log("Query results:", results);
            res.json({ message: "Address saved successfully", addressId: results.insertId });
        }
    );
});

// Xóa địa chỉ
router.delete("/:addressId", (req, res) => {
    const { addressId } = req.params;
    connection.query(
        "DELETE FROM address WHERE id = ?",
        [addressId],
        (error, results) => {
            if (error) {
                console.error("Query error:", error);
                return res.status(500).json({ message: "Error deleting address", error: error.message });
            }
            if (results.affectedRows === 0) {
                return res.status(404).json({ message: "Address not found" });
            }
            res.json({ message: "Address deleted successfully" });
        }
    );
});

// Lấy tất cả địa chỉ
router.get("/all", (req, res) => {
    connection.query(
        "SELECT * FROM address",
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json({ addresses: results });
        }
    );
});

// Thêm địa chỉ
router.post("/add", (req, res) => {
    const { user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address } = req.body;
    connection.query(
        "INSERT INTO address (user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error adding address", error: err.message });
            res.json({ message: "Address added successfully", addressId: results.insertId });
        }
    );
});

// Sửa địa chỉ
router.put("/update", (req, res) => {
    const { id, user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address } = req.body;
    connection.query(
        "UPDATE address SET user_id = ?, province_code = ?, province_name = ?, district_code = ?, district_name = ?, ward_code = ?, ward_name = ?, street_address = ? WHERE id = ?",
        [user_id, province_code, province_name, district_code, district_name, ward_code, ward_name, street_address, id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error updating address", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Address not found" });
            res.json({ message: "Address updated successfully" });
        }
    );
});

// Xóa địa chỉ
router.delete("/delete/:id", (req, res) => {
    const { id } = req.params;
    connection.query(
        "DELETE FROM address WHERE id = ?",
        [id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error deleting address", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Address not found" });
            res.json({ message: "Address deleted successfully" });
        }
    );
});

module.exports = router;