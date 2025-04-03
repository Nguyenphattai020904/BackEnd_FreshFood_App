const express = require("express");
const router = express.Router();
const connection = require("../db");

// Lưu feedback
router.post("/save", (req, res) => {
    const { user_id, name, feedback } = req.body;
    if (!user_id || !name || !feedback) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    connection.query(
        "INSERT INTO feedback (user_id, name, feedback) VALUES (?, ?, ?)",
        [user_id, name, feedback],
        (error, results) => {
            if (error) {
                console.error("Query error:", error);
                return res.status(500).json({ message: "Error saving feedback", error: error.message });
            }
            res.json({ message: "Feedback saved successfully", feedbackId: results.insertId });
        }
    );
});

// Lấy tất cả phản hồi
router.get("/all", (req, res) => {
    connection.query(
        "SELECT * FROM feedback",
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json({ feedbacks: results });
        }
    );
});

// Thêm phản hồi
router.post("/add", (req, res) => {
    const { user_id, name, feedback } = req.body;
    connection.query(
        "INSERT INTO feedback (user_id, name, feedback) VALUES (?, ?, ?)",
        [user_id, name, feedback],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error adding feedback", error: err.message });
            res.json({ message: "Feedback added successfully", feedbackId: results.insertId });
        }
    );
});

// Sửa phản hồi
router.put("/update", (req, res) => {
    const { id, user_id, name, feedback } = req.body;
    connection.query(
        "UPDATE feedback SET user_id = ?, name = ?, feedback = ? WHERE id = ?",
        [user_id, name, feedback, id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error updating feedback", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Feedback not found" });
            res.json({ message: "Feedback updated successfully" });
        }
    );
});

// Xóa phản hồi
router.delete("/delete/:id", (req, res) => {
    const { id } = req.params;
    connection.query(
        "DELETE FROM feedback WHERE id = ?",
        [id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error deleting feedback", error: err.message });
            if (results.affectedRows === 0) return res.status(404).json({ message: "Feedback not found" });
            res.json({ message: "Feedback deleted successfully" });
        }
    );
});

module.exports = router;