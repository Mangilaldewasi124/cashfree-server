// api/create-order.js
import axios from "axios";

/**
 * Serverless handler for /api/create-order
 * - expects POST { amount, splitId, memberId, customer }
 * - returns { ok:true, order: <cashfree response>, receipt: "<orderId>" }
 *
 * Important: must export default a function (Vercel serverless)
 */

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

    const body = req.body || {};
    const { amount, splitId, memberId, customer = {} } = body;

    if (!amount || !splitId || !memberId) {
      return res.status(400).json({ ok: false, error: "missing_params" });
    }

    // envs
    const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
    const CASHFREE_SECRET = process.env.CASHFREE_SECRET;
    const CASHFREE_API_BASE = process.env.CASHFREE_API_BASE || "https://sandbox.cashfree.com/pg";
    const API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";

    if (!CASHFREE_APP_ID || !CASHFREE_SECRET) {
      console.error("Missing Cashfree envs", { CASHFREE_APP_ID: !!CASHFREE_APP_ID, CASHFREE_SECRET: !!CASHFREE_SECRET });
      return res.status(500).json({ ok: false, error: "server_misconfigured" });
    }

    const orderId = `${splitId}_${memberId}_${Date.now()}`;

    const payload = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: orderId,
      order_note: `Split:${splitId}`,
      customer_details: {
        customer_id: customer.id || `cust_${Date.now()}`,
        customer_email: customer.email || "no-reply@example.com",
        customer_phone: customer.phone || "9999999999",
      },
    };

    console.log("create-order -> calling Cashfree", { orderId, amount, splitId, memberId });

    const headers = {
      "Content-Type": "application/json",
      "x-client-id": CASHFREE_APP_ID,
      "x-client-secret": CASHFREE_SECRET,
      "x-api-version": API_VERSION,
    };

    const resp = await axios.post(`${CASHFREE_API_BASE}/orders`, payload, { headers, timeout: 20000 });

    console.log("create-order -> cashfree response ok", { cf: resp.data?.cf_order_id || resp.data?.order_id || "no-id" });

    // return response to client
    return res.status(200).json({ ok: true, order: resp.data, receipt: orderId });
  } catch (err) {
    // surface full error for debugging
    console.error("create-order error:", (err.response && err.response.data) || err.message || err);
    const details = (err.response && err.response.data) || err.message || String(err);
    return res.status(500).json({ ok: false, error: "cashfree_create_failed", details });
  }
}
