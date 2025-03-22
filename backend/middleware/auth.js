const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ message: "Access token not found" });
    }
    
    // Kiểm tra định dạng "Bearer [token]"
    const tokenParts = authHeader.split(" ");
    if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
        return res.status(401).json({ message: "Invalid token format" });
    }
    
    const token = tokenParts[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token expired" });
        } else if (error.name === "JsonWebTokenError") {
            return res.status(401).json({ message: "Invalid token" });
        } else {
            return res.status(500).json({ message: "Authentication error" });
        }
    }
};

module.exports = verifyToken;