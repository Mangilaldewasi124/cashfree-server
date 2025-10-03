// api/create-order.js
import axios from "axios";
import initMiddleware from "../lib/init-middleware.js"; // if you used this before
import Cors from "cors";

const cors = initMiddleware(Cors({ origin: true }));

export default async function handler(req, res) {
  await cors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const { amount, splitId, memberId, customer = {} } = req.body || {};
  if (!amount || !splitId || !memberId) {
    return res.status(400).json({ ok: false, error: "missing_params" });
  }

  try {
    const appId = process.env.CASHFREE_APP_ID;
    const secret = process.env.CASHFREE_SECRET;
    const apiVersion = process.env.CASHFREE_API_VERSION || "2023-08-01";

    const payload = {
      order_amount: amount,
      order_currency: "INR",
      order_id: `${splitId}_${memberId}_${Date.now()}`,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_email: customer.email || null,
        customer_phone: customer.phone || null,
      },
      order_note: `Split:${splitId}`,
    };

    const resp = await axios.post("https://sandbox.cashfree.com/pg/orders", payload, {
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId,
        "x-client-secret": secret,
        "x-api-version": apiVersion,        // <-- required header
      },
      timeout: 20000,
    });

    // return whole response so client can use payment link / cf_order_id
    return res.json({ ok: true, order: resp.data, receipt: payload.order_id });
  } catch (err) {
    console.error("cashfree create-order err:", err.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: "cashfree_create_failed", details: err.response?.data || err.message });
  }
}
