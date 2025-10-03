// api/create-order.js
import axios from "axios";
import express from "express";
const router = express.Router();

// read from env (set these in Vercel or .env)
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET = process.env.CASHFREE_SECRET;
// sandbox base for Cashfree PG Orders
const CASHFREE_API_BASE = process.env.CASHFREE_API_BASE || "https://sandbox.cashfree.com/pg";

router.post("/create-order", async (req, res) => {
  try {
    const { amount, splitId, memberId, customer = {} } = req.body || {};
    if (!amount || !splitId || !memberId) {
      return res.status(400).json({ ok: false, error: "missing_parameters" });
    }

    // build order id (receipt) - you can change format
    const orderId = `${splitId}_${memberId}_${Date.now()}`;

    const payload = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: orderId,
      order_note: `Split:${splitId}`,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_email: customer.email || "no-reply@example.com",
        customer_phone: customer.phone || "9999999999",
      },
    };

    // IMPORTANT: include the api version header required by Cashfree
    const headers = {
      "Content-Type": "application/json",
      "x-client-id": CASHFREE_APP_ID,
      "x-client-secret": CASHFREE_SECRET,
      // <- add version here (choose one allowed value)
      "x-api-version": "2023-08-01",
    };

    // Call Cashfree create order
    const cfResp = await axios.post(`${CASHFREE_API_BASE}/orders`, payload, {
      headers,
      timeout: 20000,
    });

    // return full cashfree response to the client (trim if you want)
    return res.json({ ok: true, order: cfResp.data, receipt: orderId });
  } catch (err) {
    console.error("create-order err:", err.response?.data || err.message || err);
    // surface helpful error for debugging
    const details = err.response?.data || { message: err.message };
    return res.status(500).json({ ok: false, error: "cashfree_create_failed", details });
  }
});

export default router;
