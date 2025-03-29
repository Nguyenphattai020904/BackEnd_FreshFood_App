const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const connection = require("../db");
const nodemailer = require("nodemailer");
const verifyToken = require("../middleware/auth"); // Middleware để xác thực token
require("dotenv").config();

const router = express.Router();

// Cấu hình gửi email OTP
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Hàm tạo OTP ngẫu nhiên (6 số)
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Đăng ký
router.post("/register", async (req, res) => {
    const { name, email, phone, password, gender, dateOfBirth } = req.body;
    if (!name || !email || !phone || !password) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    // Kiểm tra email đã tồn tại chưa
    connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (results.length > 0) return res.status(400).json({ message: "Email already exists" });

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            connection.query(
                "INSERT INTO users (name, email, phone, password, gender, dateOfBirth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [name, email, phone, hashedPassword, gender || null, dateOfBirth || null],
                (err, result) => {
                    if (err) {
                        return res.status(500).json({ message: "Database error", error: err.sqlMessage });
                    }
                    res.status(201).json({ message: "User registered successfully" });
                }
            );
        } catch (error) {
            res.status(500).json({ message: "Server error", error: error.message });
        }
    });
});

// Đăng nhập
router.post("/login", (req, res) => {
    const { email, password } = req.body;
    connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (results.length === 0) return res.status(401).json({ message: "User not found" });

        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

        // Tạo JWT token
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

        // Trả về thông tin người dùng, bao gồm userId
        res.json({
            message: "Login successful",
            token,
            userId: user.id.toString(), // Thêm userId vào response
            user: {
                name: user.name,
                email: user.email,
                phone: user.phone,
                gender: user.gender,
                dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().split("T")[0] : null
            }
        });
    });
});

// Lấy thông tin người dùng
router.get("/user", verifyToken, (req, res) => {
    const userId = req.user.id;
    connection.query(
        "SELECT name, email, phone, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth FROM users WHERE id = ?",
        [userId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            if (results.length === 0) return res.status(404).json({ message: "User not found" });

            const user = results[0];
            res.json({
                name: user.name,
                user: {
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    gender: user.gender,
                    dateOfBirth: user.dateOfBirth // Đã được định dạng thành chuỗi YYYY-MM-DD
                }
            });
        }
    );
});

// Cập nhật thông tin người dùng
router.put("/updateProfile", verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { name, phone, gender, dateOfBirth } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ message: "Name and phone are required" });
    }

    connection.query(
        "UPDATE users SET name = ?, phone = ?, gender = ?, dateOfBirth = ?, updated_at = NOW() WHERE id = ?",
        [name, phone, gender, dateOfBirth, userId],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });

            res.json({ message: "Profile updated successfully" });
        }
    );
});

// Gửi OTP qua email
router.post("/sendOTP", (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const otp = generateOTP();
    const createdAt = new Date();

    connection.query(
        "INSERT INTO password_reset (email, otp, created_at) VALUES (?, ?, ?)",
        [email, otp, createdAt],
        (err, results) => {
            if (err) {
                return res.status(500).json({ message: "Failed to save OTP" });
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: "Your OTP Code",
                text: `Your OTP code is: ${otp}. This code will expire in 5 minutes.`,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    return res.status(500).json({ message: "Failed to send OTP" });
                }
                res.json({ message: "OTP sent successfully" });
            });
        }
    );
});

// Xác thực OTP
router.post("/verifyOTP", (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

    connection.query(
        "SELECT * FROM password_reset WHERE email = ? ORDER BY created_at DESC LIMIT 1",
        [email],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });

            if (results.length === 0) {
                return res.status(400).json({ message: "Invalid OTP or expired" });
            }

            const otpRecord = results[0];
            const now = new Date();
            const otpTime = new Date(otpRecord.created_at);
            const diffMinutes = (now - otpTime) / (1000 * 60);

            if (otpRecord.otp !== otp) {
                return res.status(400).json({ message: "Invalid OTP" });
            }

            if (diffMinutes > 5) {
                return res.status(400).json({ message: "OTP expired" });
            }

            res.json({ message: "OTP verified successfully" });
        }
    );
});

// Quên mật khẩu (Gửi OTP)
router.post("/forgotPassword", (req, res) => {
    const { email } = req.body;
    connection.query("SELECT * FROM users WHERE email = ?", [email], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (results.length === 0) return res.status(404).json({ message: "User not found" });

        const otp = generateOTP();
        const createdAt = new Date();

        connection.query(
            "INSERT INTO password_reset (email, otp, created_at) VALUES (?, ?, ?)",
            [email, otp, createdAt],
            (err, results) => {
                if (err) {
                    return res.status(500).json({ message: "Failed to save OTP" });
                }

                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: "Password Reset OTP",
                    text: `Your OTP code for password reset is: ${otp}. This code will expire in 5 minutes.`,
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        return res.status(500).json({ message: "Failed to send OTP" });
                    }
                    res.json({ message: "Password reset instructions sent to email" });
                });
            }
        );
    });
});

// Cập nhật mật khẩu
router.post("/updatePassword", async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ message: "Missing fields" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    connection.query("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Password updated successfully" });
    });
});

module.exports = router;