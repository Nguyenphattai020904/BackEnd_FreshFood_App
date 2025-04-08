require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const orderRoutes = require("./routes/order"); // Route cũ (order.js)
const productRoutes = require("./routes/productRoutes");
const addressRoutes = require("./routes/address"); 
const feedbackRoutes = require("./routes/feedback");
const voucherRoutes = require('./routes/voucherRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const voucherWebRoutes = require('./routes/voucherWebRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const orderRoutess = require('./routes/orderRoutes'); 
const spinRoutes = require('./routes/spinRoutes');

const app = express();
app.use(express.json());
app.use(cors());

// Đăng ký các route
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/order", orderRoutes); 
app.use("/api/products", productRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/notifications', notificationRoutes);
app.use('/api/vouchers/web', voucherWebRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/order', orderRoutess); 
app.use('/api/spin', spinRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));