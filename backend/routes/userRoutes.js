const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const connection = require("../db");
const nodemailer = require("nodemailer");
const verifyToken = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
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

// Cấu hình multer để lưu ảnh vào thư mục uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        console.log("📁 File received - Original name:", file.originalname, "MIME type:", file.mimetype);
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error("Only images (jpeg, jpg, png) are allowed!"));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 },
}).single("profile_img");

const fs = require("fs");
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const BASE_URL = "http://172.16.65.119:3000";

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Đăng ký
router.post("/register", async (req, res) => {
    const { name, email, phone, password, gender, dateOfBirth } = req.body;
    if (!name || !email || !phone || !password) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (results.length > 0) return res.status(400).json({ message: "Email already exists" });

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            connection.query(
                "INSERT INTO users (name, email, phone, password, gender, dateOfBirth, created_at, updated_at, profile_img) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NULL)",
                [name, email, phone, hashedPassword, gender || null, dateOfBirth || null],
                (err, result) => {
                    if (err) {
                        return res.status(500).json({ message: "Database error", error: err.sqlMessage });
                    }

                    const newUserId = result.insertId;

                    connection.query(
                        "INSERT INTO spin_attempts (user_id, spin_count, last_updated) VALUES (?, 1, NOW())",
                        [newUserId],
                        (err) => {
                            if (err) {
                                console.log("❌ Error adding initial spin:", err.message);
                            }

                            const message = "Bạn đã nhận được 1 lượt quay. Hãy quay ngay!";
                            connection.query(
                                "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'spin_received', ?, NULL)",
                                [newUserId, message],
                                (err) => {
                                    if (err) {
                                        console.log("❌ Error adding notification:", err.message);
                                    }
                                }
                            );

                            res.status(201).json({ message: "User registered successfully" });
                        }
                    );
                }
            );
        } catch (error) {
            res.status(500).json({ message: "Server error", error: error.message });
        }
    });
});

// Đăng ký qua Google
router.post("/registerWithGoogle", async (req, res) => {
    const { name, email } = req.body;

    if (!name || !email) {
        return res.status(400).json({ message: "Name and email are required" });
    }

    connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (results.length > 0) {
            // Nếu email đã tồn tại, trả về thông tin người dùng và tạo token
            const user = results[0];
            const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
            return res.status(200).json({
                message: "User already exists, logged in successfully",
                token,
                userId: user.id.toString(),
                user: {
                    name: user.name,
                    email: user.email,
                    phone: user.phone || "",
                    gender: user.gender || "",
                    dateOfBirth: user.dateOfBirth || null,
                    profile_img: user.profile_img ? `${BASE_URL}/${user.profile_img}` : null,
                },
            });
        }

        try {
            connection.query(
                "INSERT INTO users (name, email, phone, password, gender, dateOfBirth, created_at, updated_at, profile_img) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NULL)",
                [name, email, null, null, null, null],
                (err, result) => {
                    if (err) {
                        return res.status(500).json({ message: "Database error", error: err.sqlMessage });
                    }

                    const newUserId = result.insertId;

                    // Tạo token cho người dùng mới
                    const token = jwt.sign({ id: newUserId, email: email }, process.env.JWT_SECRET, { expiresIn: "1h" });

                    connection.query(
                        "INSERT INTO spin_attempts (user_id, spin_count, last_updated) VALUES (?, 1, NOW())",
                        [newUserId],
                        (err) => {
                            if (err) {
                                console.log("❌ Error adding initial spin:", err.message);
                            }

                            const message = "Bạn đã nhận được 1 lượt quay. Hãy quay ngay!";
                            connection.query(
                                "INSERT INTO notifications (user_id, type, message, related_id) VALUES (?, 'spin_received', ?, NULL)",
                                [newUserId, message],
                                (err) => {
                                    if (err) {
                                        console.log("❌ Error adding notification:", err.message);
                                    }
                                }
                            );

                            res.status(201).json({
                                message: "User registered successfully",
                                token,
                                userId: newUserId.toString(),
                                user: {
                                    name: name,
                                    email: email,
                                    phone: "",
                                    gender: "",
                                    dateOfBirth: null,
                                    profile_img: null,
                                },
                            });
                        }
                    );
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
    connection.query(
        "SELECT id, name, email, phone, password, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth, profile_img FROM users WHERE email = ?",
        [email],
        async (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (results.length === 0) return res.status(401).json({ message: "User not found" });

            const user = results[0];
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) return res.status(401).json({ message: "Invalid credentials" });

            const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

            res.json({
                message: "Login successful",
                token,
                userId: user.id.toString(),
                user: {
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    gender: user.gender || "",
                    dateOfBirth: user.dateOfBirth || null,
                    profile_img: user.profile_img ? `${BASE_URL}/${user.profile_img}` : null,
                },
            });
        }
    );
});

// Lấy thông tin người dùng
router.get("/user", verifyToken, (req, res) => {
    const userId = req.user.id;
    connection.query(
        "SELECT name, email, phone, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth, profile_img FROM users WHERE id = ?",
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
                    gender: user.gender || "",
                    dateOfBirth: user.dateOfBirth || null,
                    profile_img: user.profile_img ? `${BASE_URL}/${user.profile_img}` : null,
                },
            });
        }
    );
});

// Cập nhật thông tin người dùng (bao gồm ảnh đại diện)
router.put("/updateProfile", verifyToken, (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            console.log("❌ Multer error:", err.message);
            return res.status(400).json({ message: err.message });
        }

        const userId = req.user.id;
        let { name, phone, gender, dateOfBirth } = req.body;
        const profileImg = req.file ? `uploads/${req.file.filename}` : null;

        if (req.file) {
            console.log("📁 File saved at:", req.file.path);
            console.log("📁 File size:", req.file.size, "bytes");
        } else {
            console.log("⚠️ No file uploaded");
        }

        // Xử lý dữ liệu
        name = name ? name.replace(/^"|"$/g, "") : name;
        phone = phone ? phone.replace(/^"|"$/g, "") : phone;
        gender = gender ? gender.replace(/^"|"$/g, "") : gender;

        // Xử lý dateOfBirth
        let parsedDateOfBirth = null;
        if (dateOfBirth && dateOfBirth !== "" && dateOfBirth !== "Not set" && dateOfBirth !== "0000-00-00") {
            const date = new Date(dateOfBirth);
            if (!isNaN(date.getTime())) {
                // Điều chỉnh múi giờ trước khi định dạng
                const adjustedDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
                // Định dạng lại thành yyyy-MM-dd
                parsedDateOfBirth = adjustedDate.toISOString().split("T")[0];
            } else {
                return res.status(400).json({ message: "Invalid dateOfBirth format. Use yyyy-MM-dd" });
            }
        }

        console.log("📅 dateOfBirth before saving:", parsedDateOfBirth);

        if (!name || !phone) {
            return res.status(400).json({ message: "Name and phone are required" });
        }

        connection.query("SELECT profile_img FROM users WHERE id = ?", [userId], (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            if (results.length === 0) return res.status(404).json({ message: "User not found" });

            const oldProfileImg = results[0].profile_img;

            if (profileImg && oldProfileImg) {
                fs.unlink(oldProfileImg, (err) => {
                    if (err) console.log("❌ Error deleting old profile image:", err.message);
                });
            }

            connection.query(
                "UPDATE users SET name = ?, phone = ?, gender = ?, dateOfBirth = ?, profile_img = ?, updated_at = NOW() WHERE id = ?",
                [name, phone, gender || null, parsedDateOfBirth, profileImg || oldProfileImg, userId],
                (err, result) => {
                    if (err) {
                        console.log("❌ Database error:", err.message);
                        return res.status(500).json({ message: "Database error", error: err });
                    }
                    if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });

                    connection.query(
                        "SELECT name, email, phone, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth, profile_img FROM users WHERE id = ?",
                        [userId],
                        (err, updatedResults) => {
                            if (err) return res.status(500).json({ message: "Database error", error: err });

                            const updatedUser = updatedResults[0];
                            res.json({
                                message: "Profile updated successfully",
                                user: {
                                    name: updatedUser.name,
                                    email: updatedUser.email,
                                    phone: updatedUser.phone,
                                    gender: updatedUser.gender || "",
                                    dateOfBirth: updatedUser.dateOfBirth || "Not set",
                                    profile_img: updatedUser.profile_img ? `${BASE_URL}/${updatedUser.profile_img}` : null,
                                },
                            });
                        }
                    );
                }
            );
        });
    });
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

// Lấy danh sách tất cả người dùng
router.get("/all", (req, res) => {
    connection.query(
        "SELECT id, name, email, phone, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth, profile_img FROM users",
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json({
                users: results.map(user => ({
                    ...user,
                    gender: user.gender || "",
                    dateOfBirth: user.dateOfBirth || null,
                    profile_img: user.profile_img ? `${BASE_URL}/${user.profile_img}` : null,
                })),
            });
        }
    );
});

// Lấy thông tin người dùng theo ID
router.get("/user/:id", (req, res) => {
    const userId = req.params.id;
    connection.query(
        "SELECT id, name, email, phone, gender, DATE_FORMAT(dateOfBirth, '%Y-%m-%d') AS dateOfBirth, profile_img FROM users WHERE id = ?",
        [userId],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            if (results.length === 0) return res.status(404).json({ message: "User not found" });
            const user = results[0];
            res.json({
                ...user,
                gender: user.gender || "",
                dateOfBirth: user.dateOfBirth || null,
                profile_img: user.profile_img ? `${BASE_URL}/${user.profile_img}` : null,
            });
        }
    );
});

// Xóa người dùng
router.delete("/:id", (req, res) => {
    const userId = req.params.id;
    connection.query("SELECT profile_img FROM users WHERE id = ?", [userId], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length === 0) return res.status(404).json({ message: "User not found" });

        const profileImg = results[0].profile_img;

        if (profileImg) {
            fs.unlink(profileImg, (err) => {
                if (err) console.log("❌ Error deleting profile image:", err.message);
            });
        }

        connection.query("DELETE FROM users WHERE id = ?", [userId], (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            if (results.affectedRows === 0) return res.status(404).json({ message: "User not found" });
            res.json({ message: "User deleted successfully" });
        });
    });
});

module.exports = router;