// services/email.js - Email service using Nodemailer with Gmail SMTP
// ══════════════════════════════════════════════════════════════════════════════

const nodemailer = require('nodemailer');

let transporter = null;
let isConfigured = false;

function initTransporter() {
    if (transporter) return transporter;
    
    // Check if SMTP is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log('');
        console.log('⚠️  EMAIL NOT CONFIGURED');
        console.log('   Add these to your .env file:');
        console.log('   SMTP_HOST=smtp.gmail.com');
        console.log('   SMTP_PORT=587');
        console.log('   SMTP_USER=your-email@gmail.com');
        console.log('   SMTP_PASS=your-app-password');
        console.log('');
        return null;
    }
    
    // Gmail-specific configuration
    const isGmail = process.env.SMTP_HOST.includes('gmail');
    
    const config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    };
    
    // Gmail-specific settings for better reliability
    if (isGmail) {
        config.service = 'gmail';
        config.tls = {
            rejectUnauthorized: false
        };
    }
    
    transporter = nodemailer.createTransport(config);
    isConfigured = true;
    
    // Verify connection
    transporter.verify((error, success) => {
        if (error) {
            console.log('');
            console.log('❌ EMAIL CONNECTION FAILED');
            console.log('   Error:', error.message);
            console.log('');
            console.log('   Common fixes:');
            console.log('   1. Make sure 2-Step Verification is ON in your Google account');
            console.log('   2. Generate an App Password at: https://myaccount.google.com/apppasswords');
            console.log('   3. Use the 16-character App Password (not your regular password)');
            console.log('');
            isConfigured = false;
        } else {
            console.log('');
            console.log('✅ EMAIL CONFIGURED');
            console.log(`   Sending from: ${process.env.EMAIL_FROM || process.env.SMTP_USER}`);
            console.log('');
        }
    });
    
    return transporter;
}

async function sendEmail({ to, subject, text, html }) {
    const transport = initTransporter();
    
    const emailData = {
        from: process.env.EMAIL_FROM || `Bubblebee Cleaning <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
        html
    };
    
    if (!transport || !isConfigured) {
        // Log email instead of sending
        console.log('');
        console.log('📧 EMAIL (not sent - SMTP not configured):');
        console.log(`   To: ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   Body: ${text?.substring(0, 100)}...`);
        console.log('');
        return { messageId: 'console-' + Date.now(), sent: false };
    }
    
    try {
        const result = await transport.sendMail(emailData);
        console.log(`✅ Email sent to ${to}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   MessageID: ${result.messageId}`);
        return { ...result, sent: true };
    } catch (error) {
        console.error('');
        console.error(`❌ EMAIL FAILED`);
        console.error(`   To: ${to}`);
        console.error(`   Error: ${error.message}`);
        console.error('');
        throw error;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

const templates = {
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
${process.env.COMPANY_PHONE || '(863) 296-7215'}
${process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com'}
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: linear-gradient(135deg, #F5A623, #E09112); color: white; padding: 40px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2); }
        .header p { margin: 10px 0 0; opacity: 0.9; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 18px; margin-bottom: 20px; }
        .details { background: linear-gradient(135deg, #FFFEF7, #FFF9F0); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #F5A623; }
        .details-row { display: flex; padding: 10px 0; border-bottom: 1px dashed #e0e0e0; }
        .details-row:last-child { border-bottom: none; }
        .details-label { font-weight: 600; color: #666; min-width: 100px; }
        .details-value { color: #333; }
        .total-row { background: #F5A623; color: white; padding: 15px; border-radius: 8px; margin-top: 15px; display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; }
        .footer { background: #2D3436; color: #aaa; padding: 30px; text-align: center; font-size: 14px; }
        .footer a { color: #F5A623; text-decoration: none; }
        .bee-icon { font-size: 48px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="bee-icon">🐝</div>
            <h1>Booking Confirmed!</h1>
            <p>Your home is about to get sparkling clean</p>
        </div>
        <div class="content">
            <p class="greeting">Hi ${data.customerName},</p>
            <p>Great news! Your cleaning appointment has been confirmed. Here are the details:</p>
            
            <div class="details">
                <div class="details-row">
                    <span class="details-label">📋 Service</span>
                    <span class="details-value">${data.service}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">📅 Date</span>
                    <span class="details-value">${data.date}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">🕐 Time</span>
                    <span class="details-value">${data.time}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">📍 Address</span>
                    <span class="details-value">${data.address}</span>
                </div>
                <div class="total-row">
                    <span>Total</span>
                    <span>$${data.total}</span>
                </div>
            </div>
            
            <p>We'll send you a reminder before your appointment. If you need to make any changes, just reply to this email or give us a call!</p>
            
            <p style="margin-top: 30px;">See you soon! 🌟</p>
            <p><strong>The Bubblebee Cleaning Team</strong></p>
        </div>
        <div class="footer">
            <p><strong>🐝 Bubblebee Cleaning</strong></p>
            <p>${process.env.COMPANY_PHONE || '(863) 296-7215'} | <a href="mailto:${process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com'}">${process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com'}</a></p>
            <p style="margin-top: 15px; font-size: 12px; color: #666;">A cleaner home, a happier life</p>
        </div>
    </div>
</body>
</html>
        `
    }),
    
    bookingReminder: (data) => ({
        subject: `⏰ Reminder: Cleaning Tomorrow at ${data.time}`,
        text: `
Hi ${data.customerName},

Just a friendly reminder that your cleaning is scheduled for tomorrow!

Service: ${data.service}
Date: ${data.date}
Time: ${data.time}
Address: ${data.address}

Please ensure someone is available to let our team in, or leave access instructions.

See you tomorrow!
- The Bubblebee Cleaning Team
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: linear-gradient(135deg, #7CB69A, #5a9a78); color: white; padding: 40px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { padding: 40px 30px; }
        .details { background: #f0f9f4; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #7CB69A; }
        .details p { margin: 8px 0; }
        .footer { background: #2D3436; color: #aaa; padding: 30px; text-align: center; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⏰ Tomorrow's the Day!</h1>
        </div>
        <div class="content">
            <p>Hi ${data.customerName},</p>
            <p>Just a friendly reminder that your cleaning is scheduled for <strong>tomorrow</strong>!</p>
            
            <div class="details">
                <p><strong>📋 Service:</strong> ${data.service}</p>
                <p><strong>📅 Date:</strong> ${data.date}</p>
                <p><strong>🕐 Time:</strong> ${data.time}</p>
                <p><strong>📍 Address:</strong> ${data.address}</p>
            </div>
            
            <p>Please ensure someone is available to let our team in, or leave access instructions.</p>
            
            <p>See you tomorrow! 🌟</p>
            <p><strong>The Bubblebee Cleaning Team</strong> 🐝</p>
        </div>
        <div class="footer">
            <p>🐝 Bubblebee Cleaning | ${process.env.COMPANY_PHONE || '(863) 296-7215'}</p>
        </div>
    </div>
</body>
</html>
        `
    }),
    
    invoiceSent: (data) => ({
        subject: `📄 Invoice ${data.invoiceNumber} - $${data.total} Due`,
        text: `
Hi ${data.customerName},

Here's your invoice for cleaning services.

Invoice #: ${data.invoiceNumber}
Amount Due: $${data.total}
Due Date: ${data.dueDate}

Thank you for choosing Bubblebee Cleaning!

- The Bubblebee Team
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: #2D3436; color: white; padding: 40px 30px; text-align: center; }
        .header h1 { margin: 0; }
        .content { padding: 40px 30px; }
        .amount { font-size: 48px; font-weight: bold; color: #F5A623; text-align: center; margin: 30px 0; }
        .due-date { text-align: center; color: #888; margin-bottom: 30px; }
        .footer { background: #2D3436; color: #aaa; padding: 30px; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📄 Invoice ${data.invoiceNumber}</h1>
        </div>
        <div class="content">
            <p>Hi ${data.customerName},</p>
            <p>Here's your invoice for recent cleaning services.</p>
            
            <div class="amount">$${data.total}</div>
            <p class="due-date">Due by ${data.dueDate}</p>
            
            <p>Thank you for choosing Bubblebee Cleaning!</p>
        </div>
        <div class="footer">
            <p>🐝 Bubblebee Cleaning | ${process.env.COMPANY_PHONE || '(863) 296-7215'}</p>
        </div>
    </div>
</body>
</html>
        `
    }),
    
    welcomeCustomer: (data) => ({
        subject: `🎉 Welcome to Bubblebee Cleaning!`,
        text: `
Hi ${data.customerName},

Welcome to Bubblebee Cleaning! We're thrilled to have you.

We specialize in making homes sparkle, and we can't wait to serve you!

Questions? Just reply to this email or call us at ${process.env.COMPANY_PHONE || '(863) 296-7215'}.

Welcome aboard!
- The Bubblebee Team
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: linear-gradient(135deg, #F5A623, #E09112); color: white; padding: 50px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 32px; }
        .content { padding: 40px 30px; }
        .features { margin: 30px 0; }
        .feature { background: #FFFEF7; padding: 15px 20px; border-radius: 8px; margin: 10px 0; display: flex; align-items: center; gap: 15px; }
        .feature-icon { font-size: 24px; }
        .footer { background: #2D3436; color: #aaa; padding: 30px; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 64px; margin-bottom: 15px;">🐝</div>
            <h1>Welcome to Bubblebee!</h1>
        </div>
        <div class="content">
            <p style="font-size: 18px;">Hi ${data.customerName},</p>
            <p>We're thrilled to have you join the Bubblebee family! We specialize in making homes sparkle, and we can't wait to serve you.</p>
            
            <div class="features">
                <div class="feature">
                    <span class="feature-icon">✨</span>
                    <span>Professional, thorough cleaning every time</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">🌿</span>
                    <span>Eco-friendly products safe for your family</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">💯</span>
                    <span>100% satisfaction guaranteed</span>
                </div>
            </div>
            
            <p>Questions? Just reply to this email or call us!</p>
            
            <p style="margin-top: 30px;">Welcome aboard! 🌟</p>
            <p><strong>The Bubblebee Cleaning Team</strong></p>
        </div>
        <div class="footer">
            <p><strong>🐝 Bubblebee Cleaning</strong></p>
            <p>${process.env.COMPANY_PHONE || '(863) 296-7215'} | ${process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com'}</p>
        </div>
    </div>
</body>
</html>
        `
    }),

    // NEW BOOKING NOTIFICATION - sent to business owner
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

This booking was submitted via the website.
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .section { background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 20px 0; }
        .section h3 { margin: 0 0 15px; color: #2D3436; font-size: 16px; border-bottom: 2px solid #F5A623; padding-bottom: 8px; }
        .row { display: flex; padding: 8px 0; }
        .label { font-weight: 600; color: #666; width: 100px; }
        .value { color: #333; flex: 1; }
        .total { background: #F5A623; color: white; padding: 20px; border-radius: 12px; text-align: center; margin-top: 20px; }
        .total-amount { font-size: 36px; font-weight: bold; }
        .footer { background: #2D3436; color: #aaa; padding: 20px; text-align: center; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🆕 NEW BOOKING RECEIVED</h1>
        </div>
        <div class="content">
            <div class="section">
                <h3>👤 Customer Information</h3>
                <div class="row">
                    <span class="label">Name:</span>
                    <span class="value"><strong>${data.customerName}</strong></span>
                </div>
                <div class="row">
                    <span class="label">Email:</span>
                    <span class="value"><a href="mailto:${data.email}">${data.email}</a></span>
                </div>
                <div class="row">
                    <span class="label">Phone:</span>
                    <span class="value"><a href="tel:${data.phone || ''}">${data.phone || 'Not provided'}</a></span>
                </div>
            </div>
            
            <div class="section">
                <h3>🧹 Service Details</h3>
                <div class="row">
                    <span class="label">Service:</span>
                    <span class="value"><strong>${data.service}</strong></span>
                </div>
                <div class="row">
                    <span class="label">Date:</span>
                    <span class="value">${data.date}</span>
                </div>
                <div class="row">
                    <span class="label">Time:</span>
                    <span class="value">${data.time}</span>
                </div>
                <div class="row">
                    <span class="label">Address:</span>
                    <span class="value">${data.address}</span>
                </div>
            </div>
            
            <div class="total">
                <div>Quoted Price</div>
                <div class="total-amount">$${data.total}</div>
            </div>
            
            <p style="text-align: center; color: #888; margin-top: 20px; font-size: 13px;">
                Booking submitted via website at ${new Date().toLocaleString()}
            </p>
        </div>
        <div class="footer">
            <p>🐝 Bubblebee Cleaning - Admin Notification</p>
        </div>
    </div>
</body>
</html>
        `
    })
};

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function sendBookingConfirmation(data) {
    const template = templates.bookingConfirmation(data);
    
    // Send to customer
    const customerResult = await sendEmail({ to: data.email, ...template });
    
    // Also send notification to business owner
    const businessEmail = process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com';
    const businessTemplate = templates.newBookingNotification(data);
    try {
        await sendEmail({ to: businessEmail, ...businessTemplate });
        console.log(`📧 Business notification sent to ${businessEmail}`);
    } catch (err) {
        console.error(`Failed to send business notification: ${err.message}`);
    }
    
    return customerResult;
}

async function sendBookingReminder(data) {
    const template = templates.bookingReminder(data);
    return sendEmail({ to: data.email, ...template });
}

async function sendInvoice(data) {
    const template = templates.invoiceSent(data);
    return sendEmail({ to: data.email, ...template });
}

async function sendWelcome(data) {
    const template = templates.welcomeCustomer(data);
    return sendEmail({ to: data.email, ...template });
}

// Test email function
async function sendTestEmail(to) {
    return sendEmail({
        to,
        subject: '🐝 Bubblebee Email Test - Success!',
        text: 'If you received this email, your SMTP configuration is working correctly!',
        html: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; }
        .container { max-width: 500px; margin: 40px auto; text-align: center; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 30px; border-radius: 12px; }
        .success h1 { margin: 0 0 15px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="success">
            <h1>✅ Email Working!</h1>
            <p>Your Bubblebee email configuration is set up correctly.</p>
            <p style="margin-top: 20px; font-size: 48px;">🐝</p>
        </div>
    </div>
</body>
</html>
        `
    });
}

module.exports = {
    sendEmail,
    sendBookingConfirmation,
    sendBookingReminder,
    sendInvoice,
    sendWelcome,
    sendTestEmail,
    templates,
    initTransporter
};
