const mysql = require("mysql");

const connection = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "", // Kiểm tra lại password MySQL
    database: "freshfood_db", // Kiểm tra tên database
});

connection.connect((err) => {
    if (err) {
        console.error("❌ Database connection failed:", err);
        return;
    }
    console.log("✅ Database connected");
});

module.exports = connection;
