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
// Trust proxy for Railway
app.set('trust proxy', 1);
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
            email: process.env.SMTP_HOST ? 'configured' : 'not configured',
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
            hint: 'Make sure SMTP is configured in .env file'
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
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            phone,
            portal_access: 1
        });
        
        // Send welcome email
        await emailService.sendWelcome({
            email: email,
            customerName: firstName
        });
        
        const token = auth.generateToken({
            userId: customerId,
            email: email,
            isCustomer: true
        });
        
        res.status(201).json({
            token,
            customer: { id: customerId, email, firstName, lastName }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Get current user
app.get('/api/auth/me', auth.requireAuth, (req, res) => {
    try {
        if (req.isCustomer) {
            const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [req.userId]);
            if (!customer) return res.status(404).json({ error: 'Customer not found' });
            delete customer.passwordHash;
            res.json({ customer });
        } else {
            const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
            if (!user) return res.status(404).json({ error: 'User not found' });
            delete user.passwordHash;
            res.json({ user });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES (Website)
// ══════════════════════════════════════════════════════════════════════════════

// Get services list
app.get('/api/services', (req, res) => {
    try {
        const services = db.query('SELECT * FROM services WHERE is_active = 1');
        const addons = db.query('SELECT * FROM service_addons WHERE is_active = 1');
        
        // Get pricing settings
        const taxRate = db.queryOne("SELECT value FROM settings WHERE key = 'tax_rate'")?.value || '0';
        
        res.json({
            services,
            addons,
            pricing: {
                taxRate: parseFloat(taxRate),
                sqftRate: 0.03,
                bedroomRate: 15,
                bathroomRate: 20,
                frequencyDiscounts: { once: 0, weekly: 20, biweekly: 15, monthly: 10 }
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get services' });
    }
});

// Check service area
app.get('/api/service-area', (req, res) => {
    try {
        const { zip } = req.query;
        if (!zip) return res.status(400).json({ error: 'Zip code required' });
        
        const area = db.queryOne('SELECT * FROM service_areas WHERE zip_code = ? AND is_active = 1', [zip]);
        
        if (area) {
            res.json({ available: true, area: area.areaName, city: area.city, surcharge: area.surcharge });
        } else {
            res.json({ available: false, zip });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to check service area' });
    }
});

// Get available time slots for a date
app.get('/api/availability', (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: 'Date required' });
        
        // Get already booked slots
        const bookedSlots = db.query(`
            SELECT scheduled_time FROM bookings 
            WHERE scheduled_date = ? AND status NOT IN ('cancelled', 'no_show')
        `, [date]).map(b => b.scheduledTime);
        
        const allSlots = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'];
        const availableSlots = allSlots.filter(slot => !bookedSlots.includes(slot));
        
        res.json({ date, availableSlots, bookedSlots });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get availability' });
    }
});

// Join waitlist
app.post('/api/waitlist', (req, res) => {
    try {
        const { email, zip } = req.body;
        if (!email || !zip) return res.status(400).json({ error: 'Email and zip required' });
        
        db.insert('waitlist', { id: uuid(), email, zip_code: zip });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to join waitlist' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// BOOKING ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create booking (public - from website)
app.post('/api/bookings', async (req, res) => {
    try {
        const data = req.body;
        
        // Validate required fields
        if (!data.customerEmail || !data.scheduledDate || !data.scheduledTime) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Find or create customer
        let customer = db.queryOne('SELECT * FROM customers WHERE email = ?', [data.customerEmail.toLowerCase()]);
        
        if (!customer) {
            const customerId = uuid();
            db.insert('customers', {
                id: customerId,
                email: data.customerEmail.toLowerCase(),
                first_name: data.customerName?.split(' ')[0] || 'Customer',
                last_name: data.customerName?.split(' ').slice(1).join(' ') || '',
                phone: data.customerPhone,
                address: data.address,
                source: 'website'
            });
            customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
        }
        
        // Get service
        const serviceMap = { regular: 'svc_regular', deep: 'svc_deep', moveout: 'svc_moveout' };
        const serviceId = serviceMap[data.service] || 'svc_regular';
        const service = db.queryOne('SELECT * FROM services WHERE id = ?', [serviceId]);
        
        // Calculate price
        const basePrice = service?.basePrice || 99;
        const sizeAdjustment = Math.max(0, ((data.sqft || 1000) - 1000) * 0.03);
        const roomsAdjustment = (Math.max(0, (data.bedrooms || 1) - 1) * 15) + 
                               (Math.max(0, (data.bathrooms || 1) - 1) * 20);
        const totalPrice = data.price || Math.round(basePrice + sizeAdjustment + roomsAdjustment);
        
        // Create booking
        const bookingId = uuid();
        db.insert('bookings', {
            id: bookingId,
            customer_id: customer.id,
            service_id: serviceId,
            scheduled_date: data.scheduledDate,
            scheduled_time: data.scheduledTime,
            address: data.address || customer.address,
            sqft: data.sqft,
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            base_price: basePrice,
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
            service: service?.name || 'Cleaning',
            date: new Date(data.scheduledDate).toLocaleDateString('en-US', { 
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
        broadcast('booking:created', booking);
        
        // Send Discord webhook if configured
        sendDiscordWebhook(`🌐 **New Website Booking**\n👤 ${customer.firstName} ${customer.lastName}\n📅 ${data.scheduledDate} at ${data.scheduledTime}\n💰 $${totalPrice}`);
        
        res.status(201).json({
            success: true,
            bookingId,
            message: 'Booking confirmed',
            booking
        });
    } catch (err) {
        console.error('Create booking error:', err);
        res.status(500).json({ error: 'Failed to create booking' });
    }
});

// Get all bookings (staff only)
app.get('/api/bookings', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { date, status, customerId } = req.query;
        
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
        
        if (date) {
            sql += ' AND b.scheduled_date = ?';
            params.push(date);
        }
        if (status) {
            sql += ' AND b.status = ?';
            params.push(status);
        }
        if (customerId) {
            sql += ' AND b.customer_id = ?';
            params.push(customerId);
        }
        
        sql += ' ORDER BY b.scheduled_date DESC, b.scheduled_time ASC';
        
        const bookings = db.query(sql, params);
        res.json({ bookings });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get bookings' });
    }
});

// Get single booking
app.get('/api/bookings/:id', auth.requireAuth, (req, res) => {
    try {
        const booking = db.queryOne(`
            SELECT b.*, c.first_name || ' ' || c.last_name as customer_name,
                   c.email as customer_email, s.name as service_name
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            LEFT JOIN services s ON b.service_id = s.id
            WHERE b.id = ?
        `, [req.params.id]);
        
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        
        // Check access for customers
        if (req.isCustomer && booking.customerId !== req.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        res.json({ booking });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get booking' });
    }
});

// Update booking
app.put('/api/bookings/:id', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const booking = db.queryOne('SELECT * FROM bookings WHERE id = ?', [id]);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        
        // Build update query
        const allowedFields = ['scheduled_date', 'scheduled_time', 'status', 'assigned_to', 'notes', 'total_price'];
        const updateData = {};
        
        for (const field of allowedFields) {
            const camelField = field.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
            if (updates[camelField] !== undefined) {
                updateData[field] = updates[camelField];
            }
        }
        
        // Handle status changes
        if (updates.status === 'confirmed' && !booking.confirmedAt) {
            updateData.confirmed_at = new Date().toISOString();
        }
        if (updates.status === 'in_progress' && !booking.startedAt) {
            updateData.started_at = new Date().toISOString();
        }
        if (updates.status === 'completed' && !booking.completedAt) {
            updateData.completed_at = new Date().toISOString();
        }
        if (updates.status === 'cancelled') {
            updateData.cancelled_at = new Date().toISOString();
            updateData.cancellation_reason = updates.cancellationReason;
        }
        
        if (Object.keys(updateData).length > 0) {
            db.update('bookings', updateData, 'id = ?', [id]);
        }
        
        const updatedBooking = db.queryOne('SELECT * FROM bookings WHERE id = ?', [id]);
        broadcast('booking:updated', updatedBooking);
        
        res.json({ booking: updatedBooking });
    } catch (err) {
        console.error('Update booking error:', err);
        res.status(500).json({ error: 'Failed to update booking' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMER ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Get all customers (staff)
app.get('/api/customers', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const customers = db.query(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM bookings WHERE customer_id = c.id) as total_bookings,
                   (SELECT COUNT(*) FROM bookings WHERE customer_id = c.id AND status = 'completed') as completed_bookings
            FROM customers c
            WHERE c.is_active = 1
            ORDER BY c.created_at DESC
        `);
        res.json({ customers });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

// Get single customer
app.get('/api/customers/:id', auth.requireAuth, (req, res) => {
    try {
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });
        
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
        
        delete customer.passwordHash;
        res.json({ customer, bookings, invoices });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get customer' });
    }
});

// Create customer
app.post('/api/customers', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { email, firstName, lastName, phone, address, city, state, zipCode, notes } = req.body;
        
        if (!firstName || !lastName) {
            return res.status(400).json({ error: 'First and last name required' });
        }
        
        const customerId = uuid();
        db.insert('customers', {
            id: customerId,
            email: email?.toLowerCase(),
            first_name: firstName,
            last_name: lastName,
            phone,
            address,
            city,
            state,
            zip_code: zipCode,
            notes,
            source: 'manual'
        });
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
        broadcast('customer:created', customer);
        
        res.status(201).json({ customer });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create customer' });
    }
});

// Update customer
app.put('/api/customers/:id', auth.requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        
        // Customers can only update themselves
        if (req.isCustomer && req.userId !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const updates = req.body;
        const allowedFields = ['first_name', 'last_name', 'phone', 'address', 'city', 'state', 'zip_code', 'notes'];
        const updateData = {};
        
        for (const field of allowedFields) {
            const camelField = field.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
            if (updates[camelField] !== undefined) {
                updateData[field] = updates[camelField];
            }
        }
        
        if (Object.keys(updateData).length > 0) {
            db.update('customers', updateData, 'id = ?', [id]);
        }
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [id]);
        delete customer.passwordHash;
        
        res.json({ customer });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVOICE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Get all invoices
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

// Create invoice
app.post('/api/invoices', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { customerId, bookingId, lineItems, dueDate, notes } = req.body;
        
        if (!customerId || !lineItems?.length) {
            return res.status(400).json({ error: 'Customer and line items required' });
        }
        
        // Get invoice prefix and generate number
        const prefix = db.queryOne("SELECT value FROM settings WHERE key = 'invoice_prefix'")?.value || 'INV-';
        const lastInvoice = db.queryOne('SELECT invoice_number FROM invoices ORDER BY created_at DESC LIMIT 1');
        const nextNum = lastInvoice ? parseInt(lastInvoice.invoiceNumber.replace(/\D/g, '')) + 1 : 1001;
        const invoiceNumber = `${prefix}${nextNum}`;
        
        // Calculate totals
        const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const taxRate = parseFloat(db.queryOne("SELECT value FROM settings WHERE key = 'tax_rate'")?.value || '0');
        const taxAmount = subtotal * taxRate;
        const total = subtotal + taxAmount;
        
        // Get default due date
        const dueDays = parseInt(db.queryOne("SELECT value FROM settings WHERE key = 'invoice_due_days'")?.value || '14');
        const defaultDueDate = new Date();
        defaultDueDate.setDate(defaultDueDate.getDate() + dueDays);
        
        const invoiceId = uuid();
        db.insert('invoices', {
            id: invoiceId,
            invoice_number: invoiceNumber,
            customer_id: customerId,
            booking_id: bookingId,
            subtotal,
            tax_rate: taxRate,
            tax_amount: taxAmount,
            total,
            amount_due: total,
            due_date: dueDate || defaultDueDate.toISOString().slice(0, 10),
            notes,
            status: 'draft'
        });
        
        // Insert line items
        for (const item of lineItems) {
            db.insert('invoice_items', {
                id: uuid(),
                invoice_id: invoiceId,
                description: item.description,
                quantity: item.quantity || 1,
                unit_price: item.unitPrice,
                total: (item.quantity || 1) * item.unitPrice
            });
        }
        
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        broadcast('invoice:created', invoice);
        
        res.status(201).json({ invoice });
    } catch (err) {
        console.error('Create invoice error:', err);
        res.status(500).json({ error: 'Failed to create invoice' });
    }
});

// Send invoice
app.post('/api/invoices/:id/send', auth.requireAuth, auth.requireStaff, async (req, res) => {
    try {
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [invoice.customerId]);
        if (!customer?.email) return res.status(400).json({ error: 'Customer has no email' });
        
        await emailService.sendInvoice({
            email: customer.email,
            customerName: `${customer.firstName} ${customer.lastName}`,
            invoiceNumber: invoice.invoiceNumber,
            invoiceId: invoice.id,
            total: invoice.total,
            dueDate: invoice.dueDate
        });
        
        db.run('UPDATE invoices SET status = ?, sent_at = datetime("now") WHERE id = ?', ['sent', invoice.id]);
        
        const updatedInvoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoice.id]);
        res.json({ invoice: updatedInvoice });
    } catch (err) {
        console.error('Send invoice error:', err);
        res.status(500).json({ error: 'Failed to send invoice' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Create checkout session for invoice
app.post('/api/payments/checkout', auth.optionalAuth, async (req, res) => {
    try {
        const { invoiceId } = req.body;
        
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        
        const customer = db.queryOne('SELECT * FROM customers WHERE id = ?', [invoice.customerId]);
        
        if (!paymentService.isConfigured()) {
            return res.status(400).json({ error: 'Payments not configured' });
        }
        
        const session = await paymentService.createCheckoutSession(invoice, customer);
        
        res.json({ sessionId: session.id, url: session.url });
    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Record manual payment
app.post('/api/payments', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { invoiceId, amount, method, referenceNumber, notes } = req.body;
        
        const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        
        const paymentId = uuid();
        db.insert('payments', {
            id: paymentId,
            invoice_id: invoiceId,
            customer_id: invoice.customerId,
            amount,
            method,
            reference_number: referenceNumber,
            notes,
            status: 'completed'
        });
        
        // Update invoice
        const newAmountPaid = (invoice.amountPaid || 0) + amount;
        const newAmountDue = invoice.total - newAmountPaid;
        const newStatus = newAmountDue <= 0 ? 'paid' : 'partial';
        
        db.run(`
            UPDATE invoices 
            SET amount_paid = ?, amount_due = ?, status = ?, paid_date = datetime('now')
            WHERE id = ?
        `, [newAmountPaid, Math.max(0, newAmountDue), newStatus, invoiceId]);
        
        // Update customer total spent
        db.run('UPDATE customers SET total_spent = total_spent + ? WHERE id = ?', [amount, invoice.customerId]);
        
        broadcast('payment:received', { invoiceId, amount });
        
        res.status(201).json({ paymentId, invoice: db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]) });
    } catch (err) {
        console.error('Record payment error:', err);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// Stripe webhook handler
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['stripe-signature'];
        const event = await paymentService.handleWebhook(req.body, signature);
        
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const invoiceId = session.metadata.invoice_id;
            
            if (invoiceId) {
                const invoice = db.queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
                
                // Record payment
                db.insert('payments', {
                    id: uuid(),
                    invoice_id: invoiceId,
                    customer_id: invoice.customerId,
                    amount: session.amount_total / 100,
                    method: 'card',
                    stripe_payment_id: session.payment_intent,
                    status: 'completed'
                });
                
                // Update invoice
                db.run(`
                    UPDATE invoices 
                    SET amount_paid = total, amount_due = 0, status = 'paid', 
                        paid_date = datetime('now'), stripe_payment_intent = ?
                    WHERE id = ?
                `, [session.payment_intent, invoiceId]);
                
                broadcast('payment:received', { invoiceId });
            }
        }
        
        res.json({ received: true });
    } catch (err) {
        console.error('Stripe webhook error:', err);
        res.status(400).json({ error: 'Webhook error' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEAM/USER ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Get all team members
app.get('/api/team', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const users = db.query('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at DESC');
        users.forEach(u => delete u.passwordHash);
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get team' });
    }
});

// Create team member
app.post('/api/team', auth.requireAuth, auth.requireAdmin, (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, role, hourlyRate } = req.body;
        
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const existing = db.queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
        if (existing) return res.status(400).json({ error: 'Email already exists' });
        
        const userId = uuid();
        const passwordHash = bcrypt.hashSync(password, 10);
        
        db.insert('users', {
            id: userId,
            email: email.toLowerCase(),
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            phone,
            role: role || 'employee',
            hourly_rate: hourlyRate || 0
        });
        
        const user = db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        delete user.passwordHash;
        
        res.status(201).json({ user });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// TIME TRACKING ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Clock in
app.post('/api/time/clock-in', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { bookingId, location } = req.body;
        
        // Check if already clocked in
        const active = db.queryOne('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL', [req.userId]);
        if (active) return res.status(400).json({ error: 'Already clocked in' });
        
        const entryId = uuid();
        db.insert('time_entries', {
            id: entryId,
            user_id: req.userId,
            booking_id: bookingId,
            clock_in: new Date().toISOString(),
            clock_in_location: location
        });
        
        const entry = db.queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
        broadcast('time:clockIn', entry);
        
        res.json({ entry });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clock in' });
    }
});

// Clock out
app.post('/api/time/clock-out', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { location, notes } = req.body;
        
        const active = db.queryOne('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL', [req.userId]);
        if (!active) return res.status(400).json({ error: 'Not clocked in' });
        
        const clockOut = new Date();
        const clockIn = new Date(active.clockIn);
        const durationMinutes = Math.round((clockOut - clockIn) / 60000);
        
        db.run(`
            UPDATE time_entries 
            SET clock_out = ?, clock_out_location = ?, duration_minutes = ?, notes = ?
            WHERE id = ?
        `, [clockOut.toISOString(), location, durationMinutes, notes, active.id]);
        
        const entry = db.queryOne('SELECT * FROM time_entries WHERE id = ?', [active.id]);
        broadcast('time:clockOut', entry);
        
        res.json({ entry });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clock out' });
    }
});

// Get time entries
app.get('/api/time', auth.requireAuth, auth.requireStaff, (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        
        let sql = `
            SELECT t.*, u.first_name || ' ' || u.last_name as user_name
            FROM time_entries t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (userId) {
            sql += ' AND t.user_id = ?';
            params.push(userId);
        }
        if (startDate) {
            sql += ' AND date(t.clock_in) >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND date(t.clock_in) <= ?';
            params.push(endDate);
        }
        
        sql += ' ORDER BY t.clock_in DESC';
        
        const entries = db.query(sql, params);
        res.json({ entries });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get time entries' });
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
        
        // Top employees (by completed jobs this month)
        const topEmployees = db.query(`
            SELECT u.id, u.first_name || ' ' || u.last_name as name,
                   COUNT(*) as completed_jobs,
                   COALESCE(SUM(b.total_price), 0) as revenue
            FROM users u
            LEFT JOIN bookings b ON b.assigned_to = u.id AND b.status = 'completed' AND date(b.completed_at) >= ?
            WHERE u.is_active = 1 AND u.role != 'admin'
            GROUP BY u.id
            ORDER BY completed_jobs DESC
            LIMIT 5
        `, [monthStart]);
        
        res.json({ stats, recentBookings, topEmployees });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

// Revenue report
app.get('/api/analytics/revenue', auth.requireAuth, auth.requireManager, (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default to last 12 months
        const start = startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10);
        const end = endDate || new Date().toISOString().slice(0, 10);
        
        // Monthly revenue
        const monthlyRevenue = db.query(`
            SELECT strftime('%Y-%m', processed_at) as month,
                   SUM(amount) as collected
            FROM payments
            WHERE date(processed_at) BETWEEN ? AND ?
            GROUP BY month
            ORDER BY month
        `, [start, end]);
        
        // Monthly billed
        const monthlyBilled = db.query(`
            SELECT strftime('%Y-%m', created_at) as month,
                   SUM(total) as billed
            FROM invoices
            WHERE date(created_at) BETWEEN ? AND ?
            GROUP BY month
            ORDER BY month
        `, [start, end]);
        
        res.json({ monthlyRevenue, monthlyBilled });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get revenue report' });
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
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function sendDiscordWebhook(message) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;
    
    const https = require('https');
    const url = new URL(webhookUrl);
    
    const payload = JSON.stringify({
        embeds: [{
            description: message,
            color: 0xF5A623,
            timestamp: new Date().toISOString(),
            footer: { text: '🐝 Bubblebee' }
        }]
    });
    
    const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    req.write(payload);
    req.end();
}

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
            console.log('  🐝 BUBBLEBEE COMBINED SERVER');
            console.log('═══════════════════════════════════════════════════════════════════════');
            console.log(`  Website:    http://localhost:${PORT}`);
            console.log(`  API:        http://localhost:${PORT}/api`);
            console.log(`  WebSocket:  ws://localhost:${PORT}/ws`);
            console.log(`  Health:     http://localhost:${PORT}/api/health`);
            console.log('');
            console.log('  Services:');
            console.log(`    Database: ✅ Connected`);
            console.log(`    Email:    ${process.env.SMTP_HOST ? '✅ Configured' : '⚠️  Not configured (emails logged to console)'}`);
            console.log(`    Payments: ${paymentService.isConfigured() ? '✅ Stripe configured' : '⚠️  Not configured'}`);
            console.log(`    Discord:  ${process.env.DISCORD_WEBHOOK_URL ? '✅ Webhook configured' : '⚠️  Not configured'}`);
            console.log('');
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
