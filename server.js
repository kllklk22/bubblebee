// server.js - Bubblebee Backend Server
// ══════════════════════════════════════════════════════════════════════════════
// Full Express backend with authentication, payments, email, and real-time sync
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');

// Local modules
const db = require('./database/db');
const auth = require('./middleware/auth');
const emailService = require('./services/email');
const paymentService = require('./services/payments');
const scheduler = require('./services/scheduler');

// ══════════════════════════════════════════════════════════════════════════════
// APP SETUP
// ══════════════════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Trust proxy for Railway/Heroku/etc
app.set('trust proxy', 1);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('🔌 WebSocket client connected');
    
    ws.on('close', () => {
        wsClients.delete(ws);
        console.log('🔌 WebSocket client disconnected');
    });
});

// Broadcast to all connected clients
function broadcast(event, data) {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    wsClients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════════════════════════════

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Static files (for uploaded photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve website from public folder
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
            database: 'connected',
            email: 'configured (Resend)',
            payments: paymentService.isConfigured() ? 'configured' : 'not configured'
        }
    });
});

// Test email endpoint
app.post('/api/test-email', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email address required' });
        }
        
        const result = await emailService.sendTestEmail(email);
        res.json({ 
            success: true, 
            message: `Test email sent to ${email}`,
            messageId: result.messageId,
            sent: result.sent
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            hint: 'Make sure Resend API key is configured'
        });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Staff login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = db.queryOne('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.toLowerCase()]);
        
        if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Update last login
        db.run('UPDATE users SET last_login_at = datetime("now") WHERE id = ?', [user.id]);
        
        const token = auth.generateToken({
            userId: user.id,
            email: user.email,
            role: user.role,
            isCustomer: false
        });
        
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Customer login
app.post('/api/auth/customer/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const customer = db.queryOne('SELECT * FROM customers WHERE email = ? AND is_active = 1', [email.toLowerCase()]);
        
        if (!customer || !customer.passwordHash || !bcrypt.compareSync(password, customer.passwordHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = auth.generateToken({
            userId: customer.id,
            email: customer.email,
            isCustomer: true
        });
        
        res.json({
            token,
            customer: {
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName
            }
        });
    } catch (err) {
        console.error('Customer login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Customer registration
app.post('/api/auth/customer/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        const existing = db.queryOne('SELECT id FROM customers WHERE email = ?', [email.toLowerCase()]);
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const customerId = uuid();
        const passwordHash = bcrypt.hashSync(password, 10);
        
        db.insert('customers', {
            id: customerId,
            email: email.toLowerCase(),
            passwordHash,
            firstName,
            lastName,
            phone: phone || null,
            source: 'website',
            is_active: 1
        });
        
        // Send welcome email
        await emailService.sendWelcome({
            email: email.toLowerCase(),
            customerName: firstName
        });
        
        const token = auth.generateToken({
            userId: customerId,
            email: email.toLowerCase(),
            isCustomer: true
        });
        
        res.status(201).json({
            success: true,
            token,
            customer: {
                id: customerId,
                email: email.toLowerCase(),
                firstName,
                lastName
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Get current user
app.get('/api/auth/me', auth.requireAuth, (req, res) => {
    if (req.user.isCustomer) {
        const customer = db.queryOne('SELECT id, email, first_name as firstName, last_name as lastName, phone FROM customers WHERE id = ?', [req.user.userId]);
        return res.json({ customer });
    }
    
    const user = db.queryOne('SELECT id, email, first_name as firstName, last_name as lastName, role FROM users WHERE id = ?', [req.user.userId]);
    res.json({ user });
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVICES ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// List services (public)
app.get('/api/services', (req, res) => {
    try {
        const services = db.query('SELECT * FROM services WHERE is_active = 1 ORDER BY name');
        res.json({ services });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get services' });
    }
});

// Get service by ID (public)
app.get('/api/services/:id', (req, res) => {
    try {
        const service = db.queryOne('SELECT * FROM services WHERE id = ?', [req.params.id]);
        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }
        res.json({ service });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get service' });
    }
});

// Create service
app.post('/api/services', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const { name, description, basePrice, duration, category } = req.body;
        
        const serviceId = uuid();
        db.insert('services', {
            id: serviceId,
            name,
            description,
            base_price: basePrice,
            duration_minutes: duration || 60,
            category: category || 'general',
            is_active: 1
        });
        
        const service = db.queryOne('SELECT * FROM services WHERE id = ?', [serviceId]);
        res.status(201).json({ service });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create service' });
    }
});

// Update service
app.put('/api/services/:id', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const updates = req.body;
        db.update('services', req.params.id, updates);
        const service = db.queryOne('SELECT * FROM services WHERE id = ?', [req.params.id]);
        res.json({ service });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update service' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// List customers
app.get('/api/customers', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { search, limit = 50 } = req.query;
        
        let sql = 'SELECT * FROM customers WHERE 1=1';
        const params = [];
        
        if (search) {
            sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const customers = db.query(sql, params);
        res.json({ customers });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

// Get customer details
app.get('/api/customers/:id', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        // Get customer's bookings
        const bookings = db.query(`
            SELECT b.*, s.name as service_name 
            FROM bookings b 
            LEFT JOIN services s ON b.service_id = s.id 
            WHERE b.customer_id = ? 
            ORDER BY b.scheduled_date DESC
        `, [req.params.id]);
        
        // Get customer's invoices
        const invoices = db.query('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id]);
        
        res.json({ customer, bookings, invoices });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get customer' });
    }
});

// Create customer (admin)
app.post('/api/customers', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { email, firstName, lastName, phone, address, notes } = req.body;
        
        if (!email || !firstName || !lastName) {
            return res.status(400).json({ error: 'Email, first name, and last name required' });
        }
        
        const existing = db.queryOne('SELECT id FROM customers WHERE email = ?', [email.toLowerCase()]);
        if (existing) {
            return res.status(400).json({ error: 'Customer with this email already exists' });
        }
        
        const customerId = uuid();
        db.insert('customers', {
            id: customerId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            phone: phone || null,
            address: address || null,
            notes: notes || null,
            source: 'admin',
            is_active: 1
        });
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
        res.status(201).json({ customer });
    } catch (err) {
        console.error('Create customer error:', err);
        res.status(500).json({ error: 'Failed to create customer' });
    }
});

// Update customer
app.put('/api/customers/:id', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const updates = req.body;
        db.update('customers', req.params.id, updates);
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
        res.json({ customer });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// BOOKINGS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create booking (public - from website)
app.post('/api/bookings', async (req, res) => {
    try {
        const data = req.body;
        console.log('📅 New booking request:', data);
        
        // Find or create customer
        let customer = db.queryOne('SELECT * FROM customers WHERE email = ?', [data.customerEmail?.toLowerCase()]);
        
        if (!customer) {
            const customerId = uuid();
            const nameParts = (data.customerName || '').split(' ');
            db.insert('customers', {
                id: customerId,
                email: data.customerEmail?.toLowerCase(),
                firstName: nameParts[0] || 'Customer',
                lastName: nameParts.slice(1).join(' ') || '',
                phone: data.customerPhone || null,
                address: data.address || null,
                source: 'website',
                is_active: 1
            });
            customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
        }
        
        // Find service
        const serviceMap = {
            'standard': 'Regular Cleaning',
            'deep': 'Deep Cleaning',
            'standard_carpet': 'Standard + Carpet',
            'deep_carpet': 'Deep + Carpet',
            'standard_pressure': 'Standard + Pressure Wash',
            'pressure_only': 'Pressure Wash Only',
            'green': 'Green Clean'
        };
        
        const serviceName = serviceMap[data.service] || data.service || 'Cleaning';
        let service = db.queryOne('SELECT * FROM services WHERE name LIKE ?', [`%${serviceName}%`]);
        
        // Create booking
        const bookingId = uuid();
        const totalPrice = data.price || 0;
        
        db.insert('bookings', {
            id: bookingId,
            customer_id: customer.id,
            service_id: service?.id || null,
            scheduled_date: data.scheduledDate,
            scheduled_time: data.scheduledTime,
            address: data.address || customer.address,
            total_price: totalPrice,
            status: 'pending',
            frequency: data.frequency || 'once',
            is_recurring: data.frequency && data.frequency !== 'once' ? 1 : 0
        });
        
        const booking = db.queryOne('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        
        // Send confirmation email (also sends notification to business)
        await emailService.sendBookingConfirmation({
            email: customer.email,
            customerName: `${customer.firstName} ${customer.lastName}`,
            phone: customer.phone || data.customerPhone,
            service: serviceName,
            date: new Date(data.scheduledDate + 'T12:00:00').toLocaleDateString('en-US', { 
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
            }),
            time: data.scheduledTime,
            address: data.address,
            total: totalPrice
        });
        
        // Log communication
        db.insert('communications', {
            id: uuid(),
            customer_id: customer.id,
            booking_id: bookingId,
            type: 'email',
            direction: 'outbound',
            subject: 'Booking Confirmation',
            status: 'sent'
        });
        
        // Broadcast to dashboard
        broadcast('new_booking', { booking, customer });
        
        res.status(201).json({ 
            success: true, 
            booking,
            message: 'Booking confirmed! Check your email for details.'
        });
    } catch (err) {
        console.error('Create booking error:', err);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// List bookings (staff)
app.get('/api/bookings', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { status, date, customerId, limit = 100 } = req.query;
        
        let sql = `
            SELECT b.*, c.first_name || ' ' || c.last_name as customer_name, 
                   c.email as customer_email, c.phone as customer_phone,
                   s.name as service_name,
                   u.first_name || ' ' || u.last_name as assigned_name
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            LEFT JOIN services s ON b.service_id = s.id
            LEFT JOIN users u ON b.assigned_to = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            sql += ' AND b.status = ?';
            params.push(status);
        }
        if (date) {
            sql += ' AND b.scheduled_date = ?';
            params.push(date);
        }
        if (customerId) {
            sql += ' AND b.customer_id = ?';
            params.push(customerId);
        }
        
        sql += ' ORDER BY b.scheduled_date DESC, b.scheduled_time LIMIT ?';
        params.push(parseInt(limit));
        
        const bookings = db.query(sql, params);
        res.json({ bookings });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get bookings' });
    }
});

// Get booking by ID
app.get('/api/bookings/:id', auth.requireAuth, (req, res) => {
    try {
        const booking = db.queryOne(`
            SELECT b.*, c.first_name || ' ' || c.last_name as customer_name,
                   c.email as customer_email, c.phone as customer_phone,
                   s.name as service_name
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            LEFT JOIN services s ON b.service_id = s.id
            WHERE b.id = ?
        `, [req.params.id]);
        
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        res.json({ booking });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get booking' });
    }
});

// Update booking status
app.patch('/api/bookings/:id/status', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { status, notes } = req.body;
        
        const updates = { status };
        if (status === 'completed') {
            updates.completed_at = new Date().toISOString();
        }
        if (notes) {
            updates.notes = notes;
        }
        
        db.update('bookings', req.params.id, updates);
        const booking = db.queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
        
        broadcast('booking_updated', { booking });
        res.json({ booking });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update booking' });
    }
});

// Assign booking to staff
app.patch('/api/bookings/:id/assign', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const { userId } = req.body;
        
        db.update('bookings', req.params.id, { assigned_to: userId });
        const booking = db.queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
        
        broadcast('booking_assigned', { booking });
        res.json({ booking });
    } catch (err) {
        res.status(500).json({ error: 'Failed to assign booking' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVOICES ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create invoice
app.post('/api/invoices', auth.requireAuth, auth.requireStaff, async (req, res) => {
    try {
        const { customerId, bookingId, items, dueDate, notes } = req.body;
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        
        // Calculate total
        const total = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        
        const invoiceId = uuid();
        const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;
        
        db.insert('invoices', {
            id: invoiceId,
            invoice_number: invoiceNumber,
            customer_id: customerId,
            booking_id: bookingId || null,
            items: JSON.stringify(items),
            subtotal: total,
            tax: 0,
            total: total,
            status: 'pending',
            due_date: dueDate,
            notes: notes || null
        });
        
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        
        // Send invoice email
        await emailService.sendInvoice({
            email: customer.email,
            customerName: `${customer.firstName} ${customer.lastName}`,
            invoiceNumber,
            total,
            dueDate
        });
        
        res.status(201).json({ invoice });
    } catch (err) {
        console.error('Create invoice error:', err);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

// List invoices
app.get('/api/invoices', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { status, customerId } = req.query;
        
        let sql = `
            SELECT i.*, c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email
            FROM invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            sql += ' AND i.status = ?';
            params.push(status);
        }
        if (customerId) {
            sql += ' AND i.customer_id = ?';
            params.push(customerId);
        }
        
        sql += ' ORDER BY i.created_at DESC';
        
        const invoices = db.query(sql, params);
        res.json({ invoices });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get invoices' });
    }
});

// Get invoice by ID
app.get('/api/invoices/:id', auth.requireAuth, (req, res) => {
    try {
        const invoice = db.queryOne(`
            SELECT i.*, c.first_name || ' ' || c.last_name as customer_name, c.email as customer_email
            FROM invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE i.id = ?
        `, [req.params.id]);
        
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        invoice.items = JSON.parse(invoice.items || '[]');
        res.json({ invoice });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get invoice' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENTS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create payment intent
app.post('/api/payments/create-intent', auth.requireAuth, async (req, res) => {
    try {
        const { invoiceId, amount } = req.body;
        
        const result = await paymentService.createPaymentIntent(amount, {
            invoiceId,
            customerId: req.user.userId
        });
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});

// Record payment
app.post('/api/payments', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { invoiceId, amount, method, reference } = req.body;
        
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        
        const paymentId = uuid();
        db.insert('payments', {
            id: paymentId,
            invoice_id: invoiceId,
            customer_id: invoice.customer_id,
            amount,
            payment_method: method,
            transaction_id: reference || null,
            status: 'completed',
            processed_at: new Date().toISOString()
        });
        
        // Update invoice status
        const totalPaid = db.queryOne('SELECT SUM(amount) as total FROM payments WHERE invoice_id = ?', [invoiceId])?.total || 0;
        const newStatus = totalPaid >= invoice.total ? 'paid' : 'partial';
        db.update('invoices', invoiceId, { status: newStatus, paid_at: newStatus === 'paid' ? new Date().toISOString() : null });
        
        const payment = db.queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
        res.status(201).json({ payment });
    } catch (err) {
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// USERS/STAFF ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// List users
app.get('/api/users', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const users = db.query(`
            SELECT id, email, first_name as firstName, last_name as lastName, 
                   role, phone, is_active, created_at, last_login_at
            FROM users ORDER BY created_at DESC
        `);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Create user
app.post('/api/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
    try {
        const { email, password, firstName, lastName, role, phone } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        const existing = db.queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const userId = uuid();
        const passwordHash = bcrypt.hashSync(password, 10);
        
        db.insert('users', {
            id: userId,
            email: email.toLowerCase(),
            passwordHash,
            firstName,
            lastName,
            role: role || 'staff',
            phone: phone || null,
            is_active: 1
        });
        
        const user = db.queryOne('SELECT id, email, first_name as firstName, last_name as lastName, role FROM users WHERE id = ?', [userId]);
        res.status(201).json({ user });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
app.put('/api/users/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
    try {
        const updates = req.body;
        
        if (updates.password) {
            updates.passwordHash = bcrypt.hashSync(updates.password, 10);
            delete updates.password;
        }
        
        db.update('users', req.params.id, updates);
        const user = db.queryOne('SELECT id, email, first_name as firstName, last_name as lastName, role FROM users WHERE id = ?', [req.params.id]);
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Dashboard stats
app.get('/api/analytics/dashboard', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = new Date(new Date().setDate(1)).toISOString().slice(0, 10);
        
        const stats = {
            todayBookings: db.queryOne(`SELECT COUNT(*) as count FROM bookings WHERE scheduled_date = ?`, [today])?.count || 0,
            pendingBookings: db.queryOne(`SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'`)?.count || 0,
            monthRevenue: db.queryOne(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE date(processed_at) >= ?`, [monthStart])?.total || 0,
            activeCustomers: db.queryOne(`SELECT COUNT(*) as count FROM customers WHERE is_active = 1`)?.count || 0,
            overdueInvoices: db.queryOne(`SELECT COUNT(*) as count FROM invoices WHERE status = 'overdue'`)?.count || 0,
            completedThisMonth: db.queryOne(`SELECT COUNT(*) as count FROM bookings WHERE status = 'completed' AND date(completed_at) >= ?`, [monthStart])?.count || 0
        };
        
        // Recent bookings
        const recentBookings = db.query(`
            SELECT b.*, c.first_name || ' ' || c.last_name as customer_name, s.name as service_name
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            LEFT JOIN services s ON b.service_id = s.id
            ORDER BY b.created_at DESC LIMIT 5
        `);
        
        res.json({ stats, recentBookings });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Get settings
app.get('/api/settings', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const rows = db.query('SELECT * FROM settings');
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json({ settings });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Update settings
app.put('/api/settings', auth.requireAuth, auth.requireAdmin, (req, res) => {
    try {
        const updates = req.body;
        
        for (const [key, value] of Object.entries(updates)) {
            db.run(`
                INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
            `, [key, value, value]);
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ══════════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler - serve website for non-API routes, JSON for API routes
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
    } else {
        // Serve the website for all other routes
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════════════════════════

async function startServer() {
    try {
        // Initialize database first
        console.log('🔄 Initializing database...');
        await db.init();
        db.startAutoSave();
        
        server.listen(PORT, () => {
            console.log('');
            console.log('═══════════════════════════════════════════════════════════════════════');
            console.log('  🐝 BUBBLEBEE SERVER RUNNING');
            console.log('═══════════════════════════════════════════════════════════════════════');
            console.log(`  Port: ${PORT}`);
            console.log('  Email: ✅ Resend configured');
            console.log('═══════════════════════════════════════════════════════════════════════');
            console.log('');
            
            // Start scheduler
            scheduler.start();
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    scheduler.stop();
    db.close();
    server.close(() => process.exit(0));
});
