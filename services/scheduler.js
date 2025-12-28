// services/scheduler.js - Automated task scheduler using node-cron

const cron = require('node-cron');
const db = require('../database/db');
const email = require('./email');

let jobs = [];

function start() {
    console.log('⏰ Starting scheduler...');
    
    // Send booking reminders - runs every day at 10 AM
    jobs.push(cron.schedule('0 10 * * *', async () => {
        console.log('📬 Running: Send booking reminders');
        await sendBookingReminders();
    }));
    
    // Generate recurring bookings - runs every day at 1 AM
    jobs.push(cron.schedule('0 1 * * *', async () => {
        console.log('🔄 Running: Generate recurring bookings');
        await generateRecurringBookings();
    }));
    
    // Check for overdue invoices - runs every day at 9 AM
    jobs.push(cron.schedule('0 9 * * *', async () => {
        console.log('💰 Running: Check overdue invoices');
        await checkOverdueInvoices();
    }));
    
    // Clean up expired sessions - runs every hour
    jobs.push(cron.schedule('0 * * * *', async () => {
        await cleanExpiredSessions();
    }));
    
    // Low inventory alerts - runs every Monday at 8 AM
    jobs.push(cron.schedule('0 8 * * 1', async () => {
        console.log('📦 Running: Check low inventory');
        await checkLowInventory();
    }));
    
    console.log('✅ Scheduler started with', jobs.length, 'scheduled jobs');
}

function stop() {
    jobs.forEach(job => job.stop());
    jobs = [];
    console.log('⏹️  Scheduler stopped');
}

// Send reminders for tomorrow's bookings
async function sendBookingReminders() {
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
        
        const bookings = db.query(`
            SELECT b.*, c.email, c.first_name, c.last_name, s.name as service_name
            FROM bookings b
            JOIN customers c ON b.customer_id = c.id
            JOIN services s ON b.service_id = s.id
            WHERE b.scheduled_date = ?
            AND b.status IN ('pending', 'confirmed')
        `, [tomorrowStr]);
        
        console.log(`Found ${bookings.length} bookings for tomorrow`);
        
        for (const booking of bookings) {
            try {
                await email.sendBookingReminder({
                    email: booking.email,
                    customerName: `${booking.firstName} ${booking.lastName}`,
                    service: booking.serviceName,
                    date: new Date(booking.scheduledDate).toLocaleDateString('en-US', { 
                        weekday: 'long', month: 'long', day: 'numeric' 
                    }),
                    time: booking.scheduledTime,
                    address: booking.address
                });
                
                // Log the communication
                db.insert('communications', {
                    id: require('uuid').v4(),
                    customer_id: booking.customerId,
                    booking_id: booking.id,
                    type: 'email',
                    direction: 'outbound',
                    subject: 'Booking Reminder',
                    content: 'Automated reminder for tomorrow\'s booking',
                    status: 'sent'
                });
            } catch (err) {
                console.error(`Failed to send reminder for booking ${booking.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('sendBookingReminders error:', err);
    }
}

// Generate bookings from recurring templates
async function generateRecurringBookings() {
    try {
        const templates = db.query(`
            SELECT * FROM recurring_templates 
            WHERE is_active = 1
            AND (next_date IS NULL OR next_date <= date('now', '+14 days'))
        `);
        
        console.log(`Found ${templates.length} recurring templates to process`);
        
        for (const template of templates) {
            try {
                // Calculate next date if not set
                let nextDate = template.nextDate ? new Date(template.nextDate) : new Date();
                
                // Generate bookings for next 14 days
                const endDate = new Date();
                endDate.setDate(endDate.getDate() + 14);
                
                while (nextDate <= endDate) {
                    // Check if booking already exists for this date
                    const existing = db.queryOne(`
                        SELECT id FROM bookings 
                        WHERE recurring_id = ? AND scheduled_date = ?
                    `, [template.id, nextDate.toISOString().slice(0, 10)]);
                    
                    if (!existing) {
                        // Create new booking
                        const bookingId = require('uuid').v4();
                        db.insert('bookings', {
                            id: bookingId,
                            customer_id: template.customerId,
                            service_id: template.serviceId,
                            scheduled_date: nextDate.toISOString().slice(0, 10),
                            scheduled_time: template.preferredTime || '09:00 AM',
                            address: template.address,
                            sqft: template.sqft,
                            bedrooms: template.bedrooms,
                            bathrooms: template.bathrooms,
                            base_price: template.basePrice,
                            total_price: template.basePrice,
                            status: 'pending',
                            is_recurring: 1,
                            recurring_id: template.id,
                            frequency: template.frequency
                        });
                        
                        console.log(`Created recurring booking for ${nextDate.toISOString().slice(0, 10)}`);
                    }
                    
                    // Move to next occurrence
                    switch (template.frequency) {
                        case 'weekly':
                            nextDate.setDate(nextDate.getDate() + 7);
                            break;
                        case 'biweekly':
                            nextDate.setDate(nextDate.getDate() + 14);
                            break;
                        case 'monthly':
                            nextDate.setMonth(nextDate.getMonth() + 1);
                            break;
                    }
                }
                
                // Update next_date in template
                db.run(`
                    UPDATE recurring_templates 
                    SET next_date = ? 
                    WHERE id = ?
                `, [nextDate.toISOString().slice(0, 10), template.id]);
                
            } catch (err) {
                console.error(`Failed to process recurring template ${template.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('generateRecurringBookings error:', err);
    }
}

// Mark overdue invoices
async function checkOverdueInvoices() {
    try {
        const result = db.run(`
            UPDATE invoices 
            SET status = 'overdue', updated_at = datetime('now')
            WHERE status = 'sent' 
            AND due_date < date('now')
            AND amount_due > 0
        `);
        
        if (result.changes > 0) {
            console.log(`Marked ${result.changes} invoices as overdue`);
            
            // Get overdue invoices to send reminders
            const overdueInvoices = db.query(`
                SELECT i.*, c.email, c.first_name, c.last_name
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.status = 'overdue'
                AND date(i.updated_at) = date('now')
            `);
            
            for (const invoice of overdueInvoices) {
                // Send overdue reminder email
                try {
                    await email.sendEmail({
                        to: invoice.email,
                        subject: `Overdue Invoice ${invoice.invoiceNumber}`,
                        text: `Hi ${invoice.firstName}, your invoice ${invoice.invoiceNumber} for $${invoice.amountDue} is now overdue. Please pay at your earliest convenience.`,
                        html: `<p>Hi ${invoice.firstName},</p><p>Your invoice <strong>${invoice.invoiceNumber}</strong> for <strong>$${invoice.amountDue}</strong> is now overdue.</p><p>Please pay at your earliest convenience.</p>`
                    });
                } catch (err) {
                    console.error(`Failed to send overdue notice for invoice ${invoice.id}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('checkOverdueInvoices error:', err);
    }
}

// Clean up expired sessions
async function cleanExpiredSessions() {
    try {
        const result = db.run(`
            DELETE FROM sessions 
            WHERE expires_at < datetime('now')
        `);
        
        if (result.changes > 0) {
            console.log(`Cleaned up ${result.changes} expired sessions`);
        }
    } catch (err) {
        console.error('cleanExpiredSessions error:', err);
    }
}

// Check for low inventory
async function checkLowInventory() {
    try {
        const lowStock = db.query(`
            SELECT * FROM inventory 
            WHERE current_stock <= min_stock 
            AND is_active = 1
        `);
        
        if (lowStock.length > 0) {
            console.log(`Found ${lowStock.length} items with low stock`);
            
            // Get admin emails
            const admins = db.query(`SELECT email FROM users WHERE role = 'admin' AND is_active = 1`);
            
            const itemsList = lowStock.map(item => 
                `• ${item.name}: ${item.currentStock} ${item.unit} (min: ${item.minStock})`
            ).join('\n');
            
            for (const admin of admins) {
                await email.sendEmail({
                    to: admin.email,
                    subject: '⚠️ Low Inventory Alert',
                    text: `The following items are running low:\n\n${itemsList}`,
                    html: `<h2>Low Inventory Alert</h2><p>The following items are running low:</p><ul>${lowStock.map(item => 
                        `<li><strong>${item.name}</strong>: ${item.currentStock} ${item.unit} (min: ${item.minStock})</li>`
                    ).join('')}</ul>`
                });
            }
        }
    } catch (err) {
        console.error('checkLowInventory error:', err);
    }
}

// Manual trigger functions (can be called from API)
async function triggerReminders() {
    await sendBookingReminders();
}

async function triggerRecurring() {
    await generateRecurringBookings();
}

module.exports = {
    start,
    stop,
    triggerReminders,
    triggerRecurring,
    sendBookingReminders,
    generateRecurringBookings,
    checkOverdueInvoices
};
