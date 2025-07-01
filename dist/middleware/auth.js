"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const axios_1 = __importDefault(require("axios"));
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5001/api';
// Make sure to use the same JWT secret as the backend
const JWT_SECRET = process.env.JWT_SECRET || 'your_secure_jwt_secret_key';
/**
 * Authentication middleware that verifies JWT tokens
 */
const auth = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token, authorization denied' });
        }
        // Extract the token without the 'Bearer ' prefix
        const token = authHeader.substring(7);
        try {
            // Verify token
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            // Add user to request object
            req.user = {
                id: decoded.id,
                email: decoded.email
            };
            // Fetch user details from backend to get name and profile picture
            try {
                const response = await axios_1.default.get(`${BACKEND_API_URL}/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (response.data) {
                    req.user.firstName = response.data.firstName;
                    req.user.lastName = response.data.lastName;
                    req.user.profilePicture = response.data.profilePicture;
                }
            }
            catch (error) {
                console.warn('Could not fetch user details from backend, proceeding with limited user info');
            }
            next();
        }
        catch (error) {
            console.error('Token verification error:', error);
            return res.status(401).json({ error: 'Token is invalid' });
        }
    }
    catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.default = auth;
