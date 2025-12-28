// services/payments.js - Stripe payment integration

let stripe = null;

function getStripe() {
    if (!stripe && process.env.STRIPE_SECRET_KEY) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

// Check if Stripe is configured
function isConfigured() {
    return !!process.env.STRIPE_SECRET_KEY;
}

// Create or get Stripe customer
async function getOrCreateCustomer(customer) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    // If customer already has Stripe ID, retrieve them
    if (customer.stripeCustomerId) {
        try {
            return await stripeClient.customers.retrieve(customer.stripeCustomerId);
        } catch (err) {
            // Customer might have been deleted, create new one
        }
    }
    
    // Create new Stripe customer
    const stripeCustomer = await stripeClient.customers.create({
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        address: customer.address ? {
            line1: customer.address,
            city: customer.city,
            state: customer.state,
            postal_code: customer.zipCode
        } : undefined,
        metadata: {
            bubblebee_id: customer.id
        }
    });
    
    return stripeCustomer;
}

// Create a payment intent for an invoice
async function createPaymentIntent(invoice, customer) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    // Get or create Stripe customer
    const stripeCustomer = await getOrCreateCustomer(customer);
    
    const paymentIntent = await stripeClient.paymentIntents.create({
        amount: Math.round(invoice.amountDue * 100), // Convert to cents
        currency: 'usd',
        customer: stripeCustomer.id,
        metadata: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoiceNumber,
            customer_id: customer.id
        },
        description: `Invoice ${invoice.invoiceNumber}`,
        receipt_email: customer.email
    });
    
    return paymentIntent;
}

// Create a checkout session (redirect to Stripe checkout)
async function createCheckoutSession(invoice, customer, successUrl, cancelUrl) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const stripeCustomer = await getOrCreateCustomer(customer);
    
    const session = await stripeClient.checkout.sessions.create({
        customer: stripeCustomer.id,
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: {
                    name: `Invoice ${invoice.invoiceNumber}`,
                    description: `Bubblebee Cleaning Services`
                },
                unit_amount: Math.round(invoice.amountDue * 100)
            },
            quantity: 1
        }],
        mode: 'payment',
        success_url: successUrl || `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/payment-cancelled`,
        metadata: {
            invoice_id: invoice.id,
            customer_id: customer.id
        }
    });
    
    return session;
}

// Process a refund
async function createRefund(paymentIntentId, amount = null) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const refundParams = {
        payment_intent: paymentIntentId
    };
    
    if (amount) {
        refundParams.amount = Math.round(amount * 100);
    }
    
    return await stripeClient.refunds.create(refundParams);
}

// Webhook handler for Stripe events
async function handleWebhook(payload, signature) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        throw new Error('Stripe webhook secret not configured');
    }
    
    const event = stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
    
    return event;
}

// Get payment methods for a customer
async function getPaymentMethods(stripeCustomerId) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const paymentMethods = await stripeClient.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card'
    });
    
    return paymentMethods.data;
}

// Create a setup intent for saving cards
async function createSetupIntent(customer) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const stripeCustomer = await getOrCreateCustomer(customer);
    
    return await stripeClient.setupIntents.create({
        customer: stripeCustomer.id,
        payment_method_types: ['card']
    });
}

// Charge a saved payment method
async function chargePaymentMethod(paymentMethodId, customer, amount, description) {
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new Error('Stripe not configured');
    }
    
    const stripeCustomer = await getOrCreateCustomer(customer);
    
    return await stripeClient.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: stripeCustomer.id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description
    });
}

module.exports = {
    isConfigured,
    getOrCreateCustomer,
    createPaymentIntent,
    createCheckoutSession,
    createRefund,
    handleWebhook,
    getPaymentMethods,
    createSetupIntent,
    chargePaymentMethod
};
