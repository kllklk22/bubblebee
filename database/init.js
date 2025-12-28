// database/init.js - Initialize the SQLite database
// Run: node database/init.js

const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

async function initDatabase() {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🐝 Bubblebee Database Initialization');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    // Import and initialize database
    const db = require('./db');
    await db.init();
    
    console.log('📝 Creating tables...');
    
    // Create all tables directly
    const tables = [
        // Users (Admin & Employees)
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            phone TEXT,
            role TEXT DEFAULT 'employee',
            hourly_rate REAL DEFAULT 0,
            avatar_url TEXT,
            is_active INTEGER DEFAULT 1,
            last_login_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Customers
        `CREATE TABLE IF NOT EXISTS customers (
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
            source TEXT DEFAULT 'website',
            portal_access INTEGER DEFAULT 0,
            portal_token TEXT,
            stripe_customer_id TEXT,
            total_spent REAL DEFAULT 0,
            total_jobs INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Services
        `CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            base_price REAL NOT NULL,
            duration_minutes INTEGER DEFAULT 120,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Service Add-ons
        `CREATE TABLE IF NOT EXISTS service_addons (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            duration_minutes INTEGER DEFAULT 30,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Bookings/Jobs
        `CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            service_id TEXT NOT NULL,
            assigned_to TEXT,
            scheduled_date TEXT NOT NULL,
            scheduled_time TEXT NOT NULL,
            estimated_duration INTEGER DEFAULT 120,
            actual_duration INTEGER,
            address TEXT NOT NULL,
            city TEXT,
            state TEXT,
            zip_code TEXT,
            access_notes TEXT,
            sqft INTEGER,
            bedrooms INTEGER,
            bathrooms INTEGER,
            base_price REAL NOT NULL,
            addons_price REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            discount_reason TEXT,
            tax_amount REAL DEFAULT 0,
            total_price REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            cancellation_reason TEXT,
            is_recurring INTEGER DEFAULT 0,
            recurring_id TEXT,
            frequency TEXT,
            confirmed_at TEXT,
            started_at TEXT,
            completed_at TEXT,
            cancelled_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Booking Add-ons
        `CREATE TABLE IF NOT EXISTS booking_addons (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL,
            addon_id TEXT NOT NULL,
            price REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Recurring Templates
        `CREATE TABLE IF NOT EXISTS recurring_templates (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            service_id TEXT NOT NULL,
            frequency TEXT NOT NULL,
            preferred_day INTEGER,
            preferred_time TEXT,
            address TEXT NOT NULL,
            sqft INTEGER,
            bedrooms INTEGER,
            bathrooms INTEGER,
            base_price REAL NOT NULL,
            notes TEXT,
            is_active INTEGER DEFAULT 1,
            next_date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Invoices
        `CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            invoice_number TEXT UNIQUE NOT NULL,
            customer_id TEXT NOT NULL,
            booking_id TEXT,
            subtotal REAL NOT NULL,
            tax_rate REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            total REAL NOT NULL,
            amount_paid REAL DEFAULT 0,
            amount_due REAL NOT NULL,
            status TEXT DEFAULT 'draft',
            issue_date TEXT DEFAULT (date('now')),
            due_date TEXT,
            paid_date TEXT,
            sent_at TEXT,
            viewed_at TEXT,
            payment_method TEXT,
            stripe_invoice_id TEXT,
            stripe_payment_intent TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Invoice Line Items
        `CREATE TABLE IF NOT EXISTS invoice_items (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            description TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            unit_price REAL NOT NULL,
            total REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Payments
        `CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            amount REAL NOT NULL,
            method TEXT NOT NULL,
            status TEXT DEFAULT 'completed',
            stripe_payment_id TEXT,
            reference_number TEXT,
            notes TEXT,
            processed_at TEXT DEFAULT (datetime('now')),
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Quotes/Estimates
        `CREATE TABLE IF NOT EXISTS quotes (
            id TEXT PRIMARY KEY,
            quote_number TEXT UNIQUE NOT NULL,
            customer_id TEXT,
            customer_name TEXT,
            customer_email TEXT,
            customer_phone TEXT,
            address TEXT,
            service_id TEXT,
            sqft INTEGER,
            bedrooms INTEGER,
            bathrooms INTEGER,
            subtotal REAL NOT NULL,
            tax_amount REAL DEFAULT 0,
            total REAL NOT NULL,
            status TEXT DEFAULT 'draft',
            valid_until TEXT,
            notes TEXT,
            sent_at TEXT,
            viewed_at TEXT,
            responded_at TEXT,
            converted_to_booking_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Time Tracking
        `CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            booking_id TEXT,
            clock_in TEXT NOT NULL,
            clock_out TEXT,
            clock_in_location TEXT,
            clock_out_location TEXT,
            duration_minutes INTEGER,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Photos
        `CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL,
            user_id TEXT,
            type TEXT DEFAULT 'after',
            filename TEXT NOT NULL,
            original_name TEXT,
            mime_type TEXT,
            size_bytes INTEGER,
            url TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Communication Log
        `CREATE TABLE IF NOT EXISTS communications (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            user_id TEXT,
            booking_id TEXT,
            type TEXT NOT NULL,
            direction TEXT DEFAULT 'outbound',
            subject TEXT,
            content TEXT,
            status TEXT DEFAULT 'sent',
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Reviews/Feedback
        `CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            is_public INTEGER DEFAULT 1,
            response TEXT,
            responded_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Inventory
        `CREATE TABLE IF NOT EXISTS inventory (
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
        )`,
        
        // Inventory Usage
        `CREATE TABLE IF NOT EXISTS inventory_usage (
            id TEXT PRIMARY KEY,
            inventory_id TEXT NOT NULL,
            booking_id TEXT,
            user_id TEXT,
            quantity REAL NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Checklists
        `CREATE TABLE IF NOT EXISTS checklist_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            service_id TEXT,
            items TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        `CREATE TABLE IF NOT EXISTS booking_checklists (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL,
            template_id TEXT,
            items TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Service Areas
        `CREATE TABLE IF NOT EXISTS service_areas (
            id TEXT PRIMARY KEY,
            zip_code TEXT UNIQUE NOT NULL,
            city TEXT,
            state TEXT,
            area_name TEXT,
            is_active INTEGER DEFAULT 1,
            surcharge REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Waitlist
        `CREATE TABLE IF NOT EXISTS waitlist (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            zip_code TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Sessions
        `CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            customer_id TEXT,
            refresh_token TEXT NOT NULL,
            user_agent TEXT,
            ip_address TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Settings
        `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
        
        // Audit Log
        `CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            old_values TEXT,
            new_values TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )`
    ];
    
    let created = 0;
    for (const sql of tables) {
        try {
            db.getDB().run(sql);
            created++;
        } catch (err) {
            console.error(`❌ Error creating table:`, err.message);
        }
    }
    console.log(`✅ Created ${created} tables`);
    
    // Create indexes
    console.log('📝 Creating indexes...');
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id)',
        'CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(scheduled_date)',
        'CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)',
        'CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)',
        'CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_service_areas_zip ON service_areas(zip_code)'
    ];
    
    for (const sql of indexes) {
        try {
            db.getDB().run(sql);
        } catch (err) {
            // Ignore index errors
        }
    }
    console.log('✅ Indexes created');
    
    // Insert default services
    console.log('📝 Adding default data...');
    
    const defaultServices = [
        { id: 'svc_regular', name: 'Regular Cleaning', description: 'Weekly or bi-weekly maintenance cleaning', base_price: 99, duration_minutes: 120 },
        { id: 'svc_deep', name: 'Deep Cleaning', description: 'Thorough top-to-bottom cleaning', base_price: 179, duration_minutes: 180 },
        { id: 'svc_moveout', name: 'Move In/Out Cleaning', description: 'Complete move transition cleaning', base_price: 249, duration_minutes: 240 },
        { id: 'svc_office', name: 'Office Cleaning', description: 'Commercial workspace cleaning', base_price: 199, duration_minutes: 150 },
        { id: 'svc_window', name: 'Window Cleaning', description: 'Interior and exterior window cleaning', base_price: 79, duration_minutes: 90 },
        { id: 'svc_carpet', name: 'Carpet Cleaning', description: 'Deep extraction carpet cleaning', base_price: 149, duration_minutes: 120 }
    ];
    
    for (const svc of defaultServices) {
        try {
            const existing = db.queryOne('SELECT id FROM services WHERE id = ?', [svc.id]);
            if (!existing) {
                db.insert('services', { ...svc, is_active: 1 });
            }
        } catch (err) {
            // Ignore
        }
    }
    
    // Insert default add-ons
    const defaultAddons = [
        { id: 'addon_fridge', name: 'Inside Fridge', price: 35, duration_minutes: 30 },
        { id: 'addon_oven', name: 'Inside Oven', price: 35, duration_minutes: 30 },
        { id: 'addon_cabinets', name: 'Inside Cabinets', price: 45, duration_minutes: 45 },
        { id: 'addon_windows', name: 'Interior Windows', price: 60, duration_minutes: 45 },
        { id: 'addon_laundry', name: 'Laundry', price: 40, duration_minutes: 60 },
        { id: 'addon_closets', name: 'Organize Closets', price: 25, duration_minutes: 30 }
    ];
    
    for (const addon of defaultAddons) {
        try {
            const existing = db.queryOne('SELECT id FROM service_addons WHERE id = ?', [addon.id]);
            if (!existing) {
                db.insert('service_addons', { ...addon, is_active: 1 });
            }
        } catch (err) {
            // Ignore
        }
    }
    
    // Insert default service areas
    const defaultAreas = [
        { zip_code: '10001', city: 'New York', area_name: 'Downtown' },
        { zip_code: '10002', city: 'New York', area_name: 'Downtown' },
        { zip_code: '10003', city: 'New York', area_name: 'Downtown' },
        { zip_code: '10011', city: 'New York', area_name: 'Midtown' },
        { zip_code: '10012', city: 'New York', area_name: 'Midtown' },
        { zip_code: '10021', city: 'New York', area_name: 'Uptown' },
        { zip_code: '10022', city: 'New York', area_name: 'Uptown' }
    ];
    
    for (const area of defaultAreas) {
        try {
            const existing = db.queryOne('SELECT id FROM service_areas WHERE zip_code = ?', [area.zip_code]);
            if (!existing) {
                db.insert('service_areas', { id: uuid(), ...area, is_active: 1 });
            }
        } catch (err) {
            // Ignore
        }
    }
    
    // Insert default settings
    const defaultSettings = [
        { key: 'company_name', value: 'Bubblebee Cleaning' },
        { key: 'company_phone', value: '(555) 123-BEES' },
        { key: 'company_email', value: 'hello@bubblebee.com' },
        { key: 'tax_rate', value: '0.08' },
        { key: 'booking_lead_time_hours', value: '24' },
        { key: 'invoice_due_days', value: '14' },
        { key: 'invoice_prefix', value: 'INV-' }
    ];
    
    for (const setting of defaultSettings) {
        try {
            db.getDB().run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [setting.key, setting.value]);
        } catch (err) {
            // Ignore
        }
    }
    
    console.log('✅ Default data added');
    
    // Create default admin user
    const adminEmail = 'admin@bubblebee.com';
    const adminPassword = 'admin123';
    
    const existingAdmin = db.queryOne('SELECT id FROM users WHERE email = ?', [adminEmail]);
    
    if (!existingAdmin) {
        const passwordHash = bcrypt.hashSync(adminPassword, 10);
        const adminId = uuid();
        
        db.insert('users', {
            id: adminId,
            email: adminEmail,
            password_hash: passwordHash,
            first_name: 'Admin',
            last_name: 'User',
            role: 'admin',
            is_active: 1
        });
        
        console.log('');
        console.log('👤 Default admin user created:');
        console.log(`   Email: ${adminEmail}`);
        console.log(`   Password: ${adminPassword}`);
        console.log('   ⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
    } else {
        console.log('👤 Admin user already exists');
    }
    
    // Create demo employee
    const employeeEmail = 'employee@bubblebee.com';
    const existingEmployee = db.queryOne('SELECT id FROM users WHERE email = ?', [employeeEmail]);
    
    if (!existingEmployee) {
        const passwordHash = bcrypt.hashSync('employee123', 10);
        db.insert('users', {
            id: uuid(),
            email: employeeEmail,
            password_hash: passwordHash,
            first_name: 'Demo',
            last_name: 'Employee',
            role: 'employee',
            hourly_rate: 18.00,
            is_active: 1
        });
        
        console.log('');
        console.log('👤 Demo employee created:');
        console.log(`   Email: ${employeeEmail}`);
        console.log(`   Password: employee123`);
    }
    
    // Save database
    db.save();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✅ Database initialization complete!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: npm start');
    console.log('  2. Open: http://localhost:3001');
    console.log('');
    
    db.close();
}

initDatabase().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
