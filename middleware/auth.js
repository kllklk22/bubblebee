// middleware/auth.js - JWT Authentication middleware

const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Generate JWT token
function generateToken(payload, expiresIn = JWT_EXPIRES_IN) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Verify JWT token
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// Middleware: Require authentication
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Attach user info to request
    req.user = decoded;
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.isCustomer = decoded.isCustomer || false;
    
    next();
}

// Middleware: Require admin role
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// Middleware: Require manager or admin role
function requireManager(req, res, next) {
    if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

// Middleware: Require employee, manager, or admin (any staff)
function requireStaff(req, res, next) {
    if (!req.user || req.user.isCustomer) {
        return res.status(403).json({ error: 'Staff access required' });
    }
    next();
}

// Middleware: Optional authentication (sets req.user if token present)
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = verifyToken(token);
        
        if (decoded) {
            req.user = decoded;
            req.userId = decoded.userId;
            req.userRole = decoded.role;
            req.isCustomer = decoded.isCustomer || false;
        }
    }
    
    next();
}

// Middleware: Customer portal authentication
function requireCustomer(req, res, next) {
    if (!req.user || !req.user.isCustomer) {
        return res.status(403).json({ error: 'Customer access required' });
    }
    next();
}

// Get user from token (utility function)
function getUserFromToken(token) {
    const decoded = verifyToken(token);
    if (!decoded) return null;
    
    if (decoded.isCustomer) {
        return db.queryOne('SELECT * FROM customers WHERE id = ?', [decoded.userId]);
    } else {
        return db.queryOne('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    }
}

// API Key authentication (for webhook integrations)
function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.API_KEY;
    
    if (!validApiKey) {
        // If no API key is configured, skip this check
        return next();
    }
    
    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    
    next();
}

module.exports = {
    generateToken,
    verifyToken,
    requireAuth,
    requireAdmin,
    requireManager,
    requireStaff,
    requireCustomer,
    optionalAuth,
    requireApiKey,
    getUserFromToken
};
