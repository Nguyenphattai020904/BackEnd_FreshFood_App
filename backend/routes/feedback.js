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

module.exports = router;