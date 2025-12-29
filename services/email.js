// services/email.js - Email service for Railway
const nodemailer = require('nodemailer');

// Create transporter immediately on load
let transporter = null;

// Check environment and create transporter
const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

console.log('');
console.log('📧 EMAIL SERVICE INIT');
console.log(`   SMTP_HOST: ${smtpHost ? '✅ Set' : '❌ Missing'}`);
console.log(`   SMTP_USER: ${smtpUser ? '✅ Set (' + smtpUser + ')' : '❌ Missing'}`);
console.log(`   SMTP_PASS: ${smtpPass ? '✅ Set (hidden)' : '❌ Missing'}`);

if (smtpHost && smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: smtpUser,
            pass: smtpPass
        },
        tls: {
            rejectUnauthorized: false
        }
    });
    console.log('   ✅ Transporter created');
} else {
    console.log('   ❌ Email NOT configured - missing environment variables');
}
console.log('');

async function sendEmail({ to, subject, text, html }) {
    if (!transporter) {
        console.log(`📧 EMAIL SKIPPED (not configured): To: ${to}, Subject: ${subject}`);
        return { sent: false, reason: 'not configured' };
    }
    
    try {
        const result = await transporter.sendMail({
            from: `Bubblebee Cleaning <${smtpUser}>`,
            to,
            subject,
            text,
            html
        });
        console.log(`✅ EMAIL SENT to ${to} - Subject: ${subject}`);
        return { sent: true, messageId: result.messageId };
    } catch (error) {
        console.error(`❌ EMAIL FAILED to ${to}: ${error.message}`);
        return { sent: false, error: error.message };
    }
}

// Booking confirmation for CUSTOMER
async function sendBookingConfirmation(data) {
    const result = await sendEmail({
        to: data.email,
        subject: `✅ Booking Confirmed - ${data.date}`,
        text: `Hi ${data.customerName}, Your cleaning has been confirmed! Service: ${data.service}, Date: ${data.date}, Time: ${data.time}, Address: ${data.address}, Total: $${data.total}. We'll see you soon! - Bubblebee Cleaning (863) 296-7215`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #F5A623, #E09112); color: white; padding: 30px; text-align: center;">
        <h1 style="margin: 0;">🐝 Booking Confirmed!</h1>
    </div>
    <div style="padding: 30px; background: #f9f9f9;">
        <p>Hi ${data.customerName},</p>
        <p>Great news! Your cleaning has been confirmed.</p>
        <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #F5A623;">
            <p><strong>📋 Service:</strong> ${data.service}</p>
            <p><strong>📅 Date:</strong> ${data.date}</p>
            <p><strong>🕐 Time:</strong> ${data.time}</p>
            <p><strong>📍 Address:</strong> ${data.address}</p>
            <p style="font-size: 20px; color: #F5A623; margin-top: 15px;"><strong>💰 Total: $${data.total}</strong></p>
        </div>
        <p>We'll see you soon!</p>
        <p><strong>The Bubblebee Cleaning Team</strong><br>📞 (863) 296-7215<br>📧 bubbleb.cleaningservice@gmail.com</p>
    </div>
</body>
</html>`
    });
    
    // Also send notification to business
    await sendBusinessNotification(data);
    
    return result;
}

// Notification to BUSINESS OWNER
async function sendBusinessNotification(data) {
    const businessEmail = process.env.COMPANY_EMAIL || 'bubbleb.cleaningservice@gmail.com';
    
    return await sendEmail({
        to: businessEmail,
        subject: `🆕 NEW BOOKING - ${data.customerName} - ${data.date}`,
        text: `NEW BOOKING! Customer: ${data.customerName}, Email: ${data.email}, Phone: ${data.phone || 'N/A'}, Service: ${data.service}, Date: ${data.date}, Time: ${data.time}, Address: ${data.address}, Quote: $${data.total}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">🆕 NEW BOOKING</h1>
    </div>
    <div style="padding: 20px;">
        <h3 style="border-bottom: 2px solid #F5A623; padding-bottom: 10px;">👤 Customer</h3>
        <p><strong>Name:</strong> ${data.customerName}</p>
        <p><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
        <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
        
        <h3 style="border-bottom: 2px solid #F5A623; padding-bottom: 10px; margin-top: 20px;">🧹 Service</h3>
        <p><strong>Service:</strong> ${data.service}</p>
        <p><strong>Date:</strong> ${data.date}</p>
        <p><strong>Time:</strong> ${data.time}</p>
        <p><strong>Address:</strong> ${data.address}</p>
        
        <div style="background: #F5A623; color: white; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px;">
            <span style="font-size: 24px; font-weight: bold;">Quote: $${data.total}</span>
        </div>
    </div>
</body>
</html>`
    });
}

async function sendBookingReminder(data) {
    return await sendEmail({
        to: data.email,
        subject: `⏰ Reminder: Cleaning Tomorrow at ${data.time}`,
        text: `Hi ${data.customerName}, Reminder: Your cleaning is tomorrow! Date: ${data.date}, Time: ${data.time}, Address: ${data.address}. See you then! - Bubblebee Cleaning`,
        html: `<p>Hi ${data.customerName},</p><p>Reminder: Your cleaning is <strong>tomorrow</strong>!</p><p>Time: ${data.time}<br>Address: ${data.address}</p><p>See you then!<br>🐝 Bubblebee Cleaning</p>`
    });
}

async function sendInvoice(data) {
    return await sendEmail({
        to: data.email,
        subject: `📄 Invoice ${data.invoiceNumber} - $${data.total} Due`,
        text: `Hi ${data.customerName}, Invoice #${data.invoiceNumber}, Amount: $${data.total}, Due: ${data.dueDate}. Thank you! - Bubblebee Cleaning`,
        html: `<p>Hi ${data.customerName},</p><p>Invoice #${data.invoiceNumber}</p><p><strong>Amount Due: $${data.total}</strong><br>Due Date: ${data.dueDate}</p><p>Thank you!<br>🐝 Bubblebee Cleaning</p>`
    });
}

async function sendWelcome(data) {
    return await sendEmail({
        to: data.email,
        subject: `🎉 Welcome to Bubblebee Cleaning!`,
        text: `Hi ${data.customerName}, Welcome to Bubblebee Cleaning! We're thrilled to have you. Questions? Call us at (863) 296-7215. - The Bubblebee Team`,
        html: `<p>Hi ${data.customerName},</p><p>Welcome to Bubblebee Cleaning! 🐝</p><p>We're thrilled to have you.</p><p>Questions? Call us at (863) 296-7215</p><p>- The Bubblebee Team</p>`
    });
}

async function sendTestEmail(to) {
    return await sendEmail({
        to,
        subject: '🐝 Bubblebee Test Email',
        text: 'If you received this, email is working!',
        html: '<h1>✅ Email Working!</h1><p>Your Bubblebee email is configured correctly. 🐝</p>'
    });
}

function initTransporter() {
    return transporter;
}

module.exports = {
    sendEmail,
    sendBookingConfirmation,
    sendBookingReminder,
    sendInvoice,
    sendWelcome,
    sendTestEmail,
    initTransporter
};
