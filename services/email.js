// services/email.js - Email service using Resend API
// ══════════════════════════════════════════════════════════════════════════════
// Much better deliverability than SMTP - emails actually reach customers!

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com';
const COMPANY_PHONE = process.env.COMPANY_PHONE || '(863) 296-7215';

// Check if Resend is configured
function isConfigured() {
    return !!RESEND_API_KEY;
}

// Initialize check
if (!RESEND_API_KEY) {
    console.log('');
    console.log('⚠️  EMAIL NOT CONFIGURED');
    console.log('   Add RESEND_API_KEY to your environment variables');
    console.log('   Get your API key at: https://resend.com');
    console.log('');
} else {
    console.log('');
    console.log('✅ EMAIL CONFIGURED (Resend)');
    console.log(`   Business notifications → ${COMPANY_EMAIL}`);
    console.log('');
}

// ══════════════════════════════════════════════════════════════════════════════
// SEND EMAIL VIA RESEND API
// ══════════════════════════════════════════════════════════════════════════════

async function sendEmail({ to, subject, text, html }) {
    if (!RESEND_API_KEY) {
        console.log(`📧 EMAIL (not sent - Resend not configured):`);
        console.log(`   To: ${to}`);
        console.log(`   Subject: ${subject}`);
        return { messageId: 'not-configured-' + Date.now(), sent: false };
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'Bubblebee Cleaning <onboarding@resend.dev>',
                to: to,
                subject: subject,
                text: text,
                html: html
            })
        });

        const result = await response.json();

        if (response.ok) {
            console.log(`✅ Email sent to ${to}`);
            console.log(`   Subject: ${subject}`);
            return { messageId: result.id, sent: true };
        } else {
            console.error(`❌ Email failed to ${to}: ${result.message || JSON.stringify(result)}`);
            return { messageId: null, sent: false, error: result.message };
        }
    } catch (error) {
        console.error(`❌ Email error: ${error.message}`);
        return { messageId: null, sent: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

const templates = {
    // Customer confirmation email (sent to customer)
    bookingConfirmation: (data) => ({
        subject: `✅ Booking Confirmed - ${data.date}`,
        text: `
Hi ${data.customerName},

Your cleaning has been confirmed!

Service: ${data.service}
Date: ${data.date}
Time: ${data.time}
Address: ${data.address}
Total: $${data.total}

We'll see you soon!

- The Bubblebee Cleaning Team
${COMPANY_PHONE}
${COMPANY_EMAIL}
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <div style="background: linear-gradient(135deg, #F5A623, #E09112); color: white; padding: 40px 30px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 10px;">🐝</div>
            <h1 style="margin: 0; font-size: 28px;">Booking Confirmed!</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Your home is about to get sparkling clean</p>
        </div>
        <div style="padding: 40px 30px;">
            <p style="font-size: 18px;">Hi ${data.customerName},</p>
            <p>Great news! Your cleaning appointment has been confirmed. Here are the details:</p>
            
            <div style="background: linear-gradient(135deg, #FFFEF7, #FFF9F0); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #F5A623;">
                <p style="margin: 8px 0;"><strong>📋 Service:</strong> ${data.service}</p>
                <p style="margin: 8px 0;"><strong>📅 Date:</strong> ${data.date}</p>
                <p style="margin: 8px 0;"><strong>🕐 Time:</strong> ${data.time}</p>
                <p style="margin: 8px 0;"><strong>📍 Address:</strong> ${data.address}</p>
                <div style="background: #F5A623; color: white; padding: 15px; border-radius: 8px; margin-top: 15px; text-align: center;">
                    <strong style="font-size: 24px;">Total: $${data.total}</strong>
                </div>
            </div>
            
            <p>We'll send you a reminder before your appointment. If you need to make any changes, just reply to this email or give us a call!</p>
            
            <p style="margin-top: 30px;">See you soon! 🌟</p>
            <p><strong>The Bubblebee Cleaning Team</strong></p>
        </div>
        <div style="background: #2D3436; color: #aaa; padding: 30px; text-align: center; font-size: 14px;">
            <p style="margin: 0;"><strong style="color: white;">🐝 Bubblebee Cleaning</strong></p>
            <p style="margin: 10px 0;">${COMPANY_PHONE} | ${COMPANY_EMAIL}</p>
            <p style="margin: 10px 0 0; font-size: 12px; color: #666;">A cleaner home, a happier life</p>
        </div>
    </div>
</body>
</html>
        `
    }),

    // Business notification email (sent to you)
    newBookingNotification: (data) => ({
        subject: `🆕 NEW BOOKING - ${data.customerName} - ${data.date}`,
        text: `
NEW BOOKING RECEIVED!

Customer: ${data.customerName}
Email: ${data.email}
Phone: ${data.phone || 'Not provided'}

Service: ${data.service}
Date: ${data.date}
Time: ${data.time}
Address: ${data.address}

Quote: $${data.total}

Submitted via website.
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">🆕 NEW BOOKING RECEIVED</h1>
        </div>
        <div style="padding: 30px;">
            <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 20px 0;">
                <h3 style="margin: 0 0 15px; color: #2D3436; font-size: 16px; border-bottom: 2px solid #F5A623; padding-bottom: 8px;">👤 Customer</h3>
                <p style="margin: 8px 0;"><strong>Name:</strong> ${data.customerName}</p>
                <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
                <p style="margin: 8px 0;"><strong>Phone:</strong> <a href="tel:${data.phone || ''}">${data.phone || 'Not provided'}</a></p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 20px 0;">
                <h3 style="margin: 0 0 15px; color: #2D3436; font-size: 16px; border-bottom: 2px solid #F5A623; padding-bottom: 8px;">🧹 Service</h3>
                <p style="margin: 8px 0;"><strong>Service:</strong> ${data.service}</p>
                <p style="margin: 8px 0;"><strong>Date:</strong> ${data.date}</p>
                <p style="margin: 8px 0;"><strong>Time:</strong> ${data.time}</p>
                <p style="margin: 8px 0;"><strong>Address:</strong> ${data.address}</p>
            </div>
            
            <div style="background: #F5A623; color: white; padding: 20px; border-radius: 12px; text-align: center; margin-top: 20px;">
                <div>Quoted Price</div>
                <div style="font-size: 36px; font-weight: bold;">$${data.total}</div>
            </div>
            
            <p style="text-align: center; color: #888; margin-top: 20px; font-size: 13px;">
                Submitted ${new Date().toLocaleString()}
            </p>
        </div>
    </div>
</body>
</html>
        `
    }),

    // Reminder email
    bookingReminder: (data) => ({
        subject: `⏰ Reminder: Cleaning Tomorrow at ${data.time}`,
        text: `
Hi ${data.customerName},

Just a friendly reminder that your cleaning is scheduled for tomorrow!

Service: ${data.service}
Date: ${data.date}
Time: ${data.time}
Address: ${data.address}

See you tomorrow!
- The Bubblebee Cleaning Team
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background: white;">
        <div style="background: linear-gradient(135deg, #7CB69A, #5a9a78); color: white; padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">⏰ Tomorrow's the Day!</h1>
        </div>
        <div style="padding: 40px 30px;">
            <p>Hi ${data.customerName},</p>
            <p>Just a friendly reminder that your cleaning is scheduled for <strong>tomorrow</strong>!</p>
            
            <div style="background: #f0f9f4; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #7CB69A;">
                <p style="margin: 8px 0;"><strong>📋 Service:</strong> ${data.service}</p>
                <p style="margin: 8px 0;"><strong>📅 Date:</strong> ${data.date}</p>
                <p style="margin: 8px 0;"><strong>🕐 Time:</strong> ${data.time}</p>
                <p style="margin: 8px 0;"><strong>📍 Address:</strong> ${data.address}</p>
            </div>
            
            <p>Please ensure someone is available to let our team in.</p>
            <p>See you tomorrow! 🌟</p>
            <p><strong>The Bubblebee Cleaning Team</strong> 🐝</p>
        </div>
    </div>
</body>
</html>
        `
    })
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

// Send booking confirmation to BOTH customer AND business
async function sendBookingConfirmation(data) {
    const results = { customer: null, business: null };
    
    // 1. Send to CUSTOMER
    try {
        const customerTemplate = templates.bookingConfirmation(data);
        results.customer = await sendEmail({
            to: data.email,
            ...customerTemplate
        });
        console.log(`📧 Customer confirmation sent to ${data.email}`);
    } catch (err) {
        console.error(`❌ Failed to send customer email: ${err.message}`);
        results.customer = { sent: false, error: err.message };
    }
    
    // 2. Send to BUSINESS (you)
    try {
        const businessTemplate = templates.newBookingNotification(data);
        results.business = await sendEmail({
            to: COMPANY_EMAIL,
            ...businessTemplate
        });
        console.log(`📧 Business notification sent to ${COMPANY_EMAIL}`);
    } catch (err) {
        console.error(`❌ Failed to send business email: ${err.message}`);
        results.business = { sent: false, error: err.message };
    }
    
    return results;
}

async function sendBookingReminder(data) {
    const template = templates.bookingReminder(data);
    return sendEmail({ to: data.email, ...template });
}

// Test email
async function sendTestEmail(to) {
    return sendEmail({
        to,
        subject: '🐝 Bubblebee Email Test - Success!',
        text: 'If you received this, your email is working!',
        html: `
<div style="font-family: Arial; max-width: 500px; margin: 40px auto; text-align: center;">
    <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 30px; border-radius: 12px;">
        <h1 style="margin: 0 0 15px;">✅ Email Working!</h1>
        <p>Your Bubblebee email is configured correctly.</p>
        <p style="font-size: 48px; margin: 20px 0;">🐝</p>
    </div>
</div>
        `
    });
}

// Placeholder for other functions (keep for compatibility)
async function sendInvoice(data) {
    console.log('sendInvoice not implemented yet');
    return { sent: false };
}

async function sendWelcome(data) {
    console.log('sendWelcome not implemented yet');
    return { sent: false };
}

function initTransporter() {
    // Not needed for Resend, but keep for compatibility
    return null;
}

module.exports = {
    sendEmail,
    sendBookingConfirmation,
    sendBookingReminder,
    sendInvoice,
    sendWelcome,
    sendTestEmail,
    templates,
    initTransporter,
    isConfigured
};
