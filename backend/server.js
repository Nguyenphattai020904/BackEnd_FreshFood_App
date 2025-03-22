require("dotenv").config();
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const orderRoutes = require("./routes/order");

const app = express();
app.use(express.json());
app.use(cors());

app.use("/api/users", userRoutes); 
app.use("/api/chat", chatRoutes);
app.use("/order", orderRoutes);

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
