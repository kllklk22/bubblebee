// services/email.js - Email service using Resend
const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_6bZUEwwQ_4Bi9JKenq8sN4cYJy9btUKaP';
const FROM_EMAIL = 'Bubblebee Cleaning <onboarding@resend.dev>'; // Use your domain after verifying in Resend

console.log('');
console.log('📧 EMAIL SERVICE INIT (Resend)');
console.log(`   API Key: ${RESEND_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log('');

function sendEmailViaResend(to, subject, html, text) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            from: FROM_EMAIL,
            to: [to],
            subject: subject,
            html: html,
            text: text
        });

        const options = {
            hostname: 'api.resend.com',
            port: 443,
            path: '/emails',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`✅ EMAIL SENT to ${to}`);
                    resolve({ sent: true, response: JSON.parse(body) });
                } else {
                    console.error(`❌ EMAIL FAILED to ${to}: ${body}`);
                    reject(new Error(body));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ EMAIL ERROR: ${e.message}`);
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

async function sendEmail({ to, subject, text, html }) {
    try {
        return await sendEmailViaResend(to, subject, html, text);
    } catch (error) {
        console.error(`❌ sendEmail failed: ${error.message}`);
        return { sent: false, error: error.message };
    }
}

// Booking confirmation for CUSTOMER
async function sendBookingConfirmation(data) {
    const html = `
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
</html>`;

    const text = `Hi ${data.customerName}, Your cleaning has been confirmed! Service: ${data.service}, Date: ${data.date}, Time: ${data.time}, Address: ${data.address}, Total: $${data.total}. We'll see you soon! - Bubblebee Cleaning (863) 296-7215`;

    const result = await sendEmail({
        to: data.email,
        subject: `✅ Booking Confirmed - ${data.date}`,
        html,
        text
    });

    // Also send to business
    await sendBusinessNotification(data);

    return result;
}

// Notification to BUSINESS OWNER
async function sendBusinessNotification(data) {
    const businessEmail = 'bubbleb.cleaningservice@gmail.com';

    const html = `
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
</html>`;

    const text = `NEW BOOKING! Customer: ${data.customerName}, Email: ${data.email}, Phone: ${data.phone || 'N/A'}, Service: ${data.service}, Date: ${data.date}, Time: ${data.time}, Address: ${data.address}, Quote: $${data.total}`;

    return await sendEmail({
        to: businessEmail,
        subject: `🆕 NEW BOOKING - ${data.customerName} - ${data.date}`,
        html,
        text
    });
}

async function sendBookingReminder(data) {
    return await sendEmail({
        to: data.email,
        subject: `⏰ Reminder: Cleaning Tomorrow at ${data.time}`,
        text: `Hi ${data.customerName}, Reminder: Your cleaning is tomorrow! Time: ${data.time}, Address: ${data.address}. See you then! - Bubblebee Cleaning`,
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
        text: `Hi ${data.customerName}, Welcome to Bubblebee Cleaning! We're thrilled to have you. Call us at (863) 296-7215. - The Bubblebee Team`,
        html: `<p>Hi ${data.customerName},</p><p>Welcome to Bubblebee Cleaning! 🐝</p><p>We're thrilled to have you.</p><p>Questions? Call us at (863) 296-7215</p><p>- The Bubblebee Team</p>`
    });
}

async function sendTestEmail(to) {
    return await sendEmail({
        to,
        subject: '🐝 Bubblebee Test Email',
        text: 'If you received this, email is working!',
        html: '<h1>✅ Email Working!</h1><p>Your Bubblebe
