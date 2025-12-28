-- ══════════════════════════════════════════════════════════════════════════════
-- BUBBLEBEE CLEANING - DATABASE SCHEMA
-- ══════════════════════════════════════════════════════════════════════════════
-- SQLite database schema for the full backend
-- Run: node database/init.js to create the database
-- ══════════════════════════════════════════════════════════════════════════════

-- Users (Admin & Employees)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'employee' CHECK(role IN ('admin', 'manager', 'employee')),
    hourly_rate REAL DEFAULT 0,
    avatar_url TEXT,
    is_active INTEGER DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    notes TEXT,
    source TEXT DEFAULT 'website' CHECK(source IN ('website', 'phone', 'referral', 'other')),
    portal_access INTEGER DEFAULT 0,
    portal_token TEXT,
    stripe_customer_id TEXT,
    total_spent REAL DEFAULT 0,
    total_jobs INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Services
CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_price REAL NOT NULL,
    duration_minutes INTEGER DEFAULT 120,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Service Add-ons
CREATE TABLE IF NOT EXISTS service_addons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Bookings/Jobs
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    assigned_to TEXT,
    
    -- Scheduling
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    estimated_duration INTEGER DEFAULT 120,
    actual_duration INTEGER,
    
    -- Location
    address TEXT NOT NULL,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    access_notes TEXT,
    
    -- Property details
    sqft INTEGER,
    bedrooms INTEGER,
    bathrooms INTEGER,
    
    -- Pricing
    base_price REAL NOT NULL,
    addons_price REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_reason TEXT,
    tax_amount REAL DEFAULT 0,
    total_price REAL NOT NULL,
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
    cancellation_reason TEXT,
    
    -- Recurring
    is_recurring INTEGER DEFAULT 0,
    recurring_id TEXT,
    frequency TEXT CHECK(frequency IN ('once', 'weekly', 'biweekly', 'monthly')),
    
    -- Timestamps
    confirmed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- Booking Add-ons (many-to-many)
CREATE TABLE IF NOT EXISTS booking_addons (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    addon_id TEXT NOT NULL,
    price REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (addon_id) REFERENCES service_addons(id)
);

-- Recurring Templates
CREATE TABLE IF NOT EXISTS recurring_templates (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly')),
    preferred_day INTEGER, -- 0-6 (Sunday-Saturday)
    preferred_time TEXT,
    address TEXT NOT NULL,
    sqft INTEGER,
    bedrooms INTEGER,
    bathrooms INTEGER,
    base_price REAL NOT NULL,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    next_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL,
    booking_id TEXT,
    
    -- Amounts
    subtotal REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    amount_paid REAL DEFAULT 0,
    amount_due REAL NOT NULL,
    
    -- Status
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'viewed', 'paid', 'partial', 'overdue', 'cancelled', 'refunded')),
    
    -- Dates
    issue_date TEXT DEFAULT (date('now')),
    due_date TEXT,
    paid_date TEXT,
    sent_at TEXT,
    viewed_at TEXT,
    
    -- Payment
    payment_method TEXT,
    stripe_invoice_id TEXT,
    stripe_payment_intent TEXT,
    
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('cash', 'check', 'card', 'bank_transfer', 'other')),
    status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
    stripe_payment_id TEXT,
    reference_number TEXT,
    notes TEXT,
    processed_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Quotes/Estimates
CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    quote_number TEXT UNIQUE NOT NULL,
    customer_id TEXT,
    
    -- Customer info (if not registered)
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    address TEXT,
    
    -- Details
    service_id TEXT,
    sqft INTEGER,
    bedrooms INTEGER,
    bathrooms INTEGER,
    
    -- Pricing
    subtotal REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    
    -- Status
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),
    valid_until TEXT,
    
    notes TEXT,
    sent_at TEXT,
    viewed_at TEXT,
    responded_at TEXT,
    converted_to_booking_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- Time Tracking
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    booking_id TEXT,
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    clock_in_location TEXT,
    clock_out_location TEXT,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT DEFAULT 'after' CHECK(type IN ('before', 'after', 'issue')),
    filename TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    url TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Communication Log
CREATE TABLE IF NOT EXISTS communications (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    user_id TEXT,
    booking_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('email', 'sms', 'call', 'note', 'system')),
    direction TEXT DEFAULT 'outbound' CHECK(direction IN ('inbound', 'outbound')),
    subject TEXT,
    content TEXT,
    status TEXT DEFAULT 'sent' CHECK(status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- Reviews/Feedback
CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    is_public INTEGER DEFAULT 1,
    response TEXT,
    responded_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    sku TEXT,
    unit TEXT DEFAULT 'each',
    current_stock REAL DEFAULT 0,
    min_stock REAL DEFAULT 0,
    cost_per_unit REAL DEFAULT 0,
    supplier TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Inventory Usage
CREATE TABLE IF NOT EXISTS inventory_usage (
    id TEXT PRIMARY KEY,
    inventory_id TEXT NOT NULL,
    booking_id TEXT,
    user_id TEXT,
    quantity REAL NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (inventory_id) REFERENCES inventory(id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Checklists
CREATE TABLE IF NOT EXISTS checklist_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    service_id TEXT,
    items TEXT NOT NULL, -- JSON array of items
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS booking_checklists (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    template_id TEXT,
    items TEXT NOT NULL, -- JSON array with completion status
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
);

-- Service Areas
CREATE TABLE IF NOT EXISTS service_areas (
    id TEXT PRIMARY KEY,
    zip_code TEXT UNIQUE NOT NULL,
    city TEXT,
    state TEXT,
    area_name TEXT,
    is_active INTEGER DEFAULT 1,
    surcharge REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Waitlist (for unserviced areas)
CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Sessions (for JWT refresh tokens)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    customer_id TEXT,
    refresh_token TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    old_values TEXT, -- JSON
    new_values TEXT, -- JSON
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned ON bookings(assigned_to);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(clock_in);
CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_areas_zip ON service_areas(zip_code);

-- ══════════════════════════════════════════════════════════════════════════════
-- DEFAULT DATA
-- ══════════════════════════════════════════════════════════════════════════════

-- Default Services
INSERT OR IGNORE INTO services (id, name, description, base_price, duration_minutes) VALUES
('svc_regular', 'Regular Cleaning', 'Weekly or bi-weekly maintenance cleaning', 99, 120),
('svc_deep', 'Deep Cleaning', 'Thorough top-to-bottom cleaning', 179, 180),
('svc_moveout', 'Move In/Out Cleaning', 'Complete move transition cleaning', 249, 240),
('svc_office', 'Office Cleaning', 'Commercial workspace cleaning', 199, 150),
('svc_window', 'Window Cleaning', 'Interior and exterior window cleaning', 79, 90),
('svc_carpet', 'Carpet Cleaning', 'Deep extraction carpet cleaning', 149, 120);

-- Default Add-ons
INSERT OR IGNORE INTO service_addons (id, name, description, price, duration_minutes) VALUES
('addon_fridge', 'Inside Fridge', 'Deep clean inside refrigerator', 35, 30),
('addon_oven', 'Inside Oven', 'Deep clean inside oven', 35, 30),
('addon_cabinets', 'Inside Cabinets', 'Clean inside all cabinets', 45, 45),
('addon_windows', 'Interior Windows', 'Clean all interior windows', 60, 45),
('addon_laundry', 'Laundry', 'Wash, dry, and fold laundry', 40, 60),
('addon_closets', 'Organize Closets', 'Organize and tidy closets', 25, 30),
('addon_baseboards', 'Baseboards', 'Detail clean all baseboards', 30, 30),
('addon_blinds', 'Blinds/Shutters', 'Clean blinds and shutters', 35, 30);

-- Default Service Areas (example - customize for your area)
INSERT OR IGNORE INTO service_areas (id, zip_code, city, area_name, is_active) VALUES
('area_1', '10001', 'New York', 'Downtown', 1),
('area_2', '10002', 'New York', 'Downtown', 1),
('area_3', '10003', 'New York', 'Downtown', 1),
('area_4', '10011', 'New York', 'Midtown', 1),
('area_5', '10012', 'New York', 'Midtown', 1),
('area_6', '10013', 'New York', 'Midtown', 1),
('area_7', '10021', 'New York', 'Uptown', 1),
('area_8', '10022', 'New York', 'Uptown', 1),
('area_9', '10023', 'New York', 'Uptown', 1);

-- Default Settings
INSERT OR IGNORE INTO settings (key, value) VALUES
('company_name', 'Bubblebee Cleaning'),
('company_phone', '(555) 123-BEES'),
('company_email', 'hello@bubblebee.com'),
('tax_rate', '0.08'),
('booking_lead_time_hours', '24'),
('cancellation_window_hours', '48'),
('reminder_hours_before', '24'),
('invoice_due_days', '14'),
('invoice_prefix', 'INV-'),
('quote_prefix', 'QT-'),
('quote_valid_days', '30');
