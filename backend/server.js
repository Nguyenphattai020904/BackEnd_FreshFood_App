require("dotenv").config();
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const orderRoutes = require("./routes/order");
const productRoutes = require("./routes/productRoutes");
const addressRoutes = require("./routes/address"); 
const feedbackRoutes = require("./routes/feedback");

const app = express();
app.use(express.json());
app.use(cors());

app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/order", orderRoutes);
app.use("/products", productRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/feedback", feedbackRoutes);

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));