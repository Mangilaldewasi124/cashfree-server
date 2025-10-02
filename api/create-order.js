// api/create-order.js
import fetch from "node-fetch";

function getCashfreeBase() {
  const env = process.env.CASHFREE_ENV || "sandbox";
  // cashfree docs: sandbox base is https://sandbox.cashfree.com/pg
  return env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { amount, splitId, memberId, customer = {} } = req.body || {};
    if (!amount || !splitId || !memberId) return res.status(400).json({ ok: false, error: "missing params (amount, splitId, memberId)" });

    const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
    const CASHFREE_SECRET = process.env.CASHFREE_SECRET;
    if (!CASHFREE_APP_ID || !CASHFREE_SECRET) {
      console.error("Missing Cashfree envs");
      return res.status(500).json({ ok: false, error: "server misconfigured" });
    }

    const orderId = `${splitId}_${memberId}_${Date.now()}`;
    const payload = {
      order_id: orderId,
      order_amount: parseFloat(amount),
      order_currency: "INR",
      order_note: `Split:${splitId}`,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_email: customer.email || null,
        customer_phone: customer.phone || null,
      },
      // optionally you can set notify_url here to your webhook endpoint
      // order_meta: { notify_url: "https://yourdomain/api/cashfree-webhook" }
    };

    const base = getCashfreeBase();
    const resp = await fetch(`${base}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET,
        "x-api-version": "2023-01-01", // Cashfree wants a version header in some APIs; add if needed (see docs)
      },
      body: JSON.stringify(payload),
      timeout: 20000,
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("cashfree create-order err", data);
      return res.status(500).json({ ok: false, error: "cashfree_create_failed", details: data });
    }

    // Save an order doc to Firestore/payments if you want here.
    // For now return order data to client.
    return res.status(200).json({ ok: true, order: data, receipt: orderId });
  } catch (err) {
    console.error("create-order handler err", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
