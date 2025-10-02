import Cors from "cors";
import initMiddleware from "../../lib/init-middleware.js";
import axios from "axios";

const cors = initMiddleware(
  Cors({
    methods: ["POST", "OPTIONS"],
  })
);

export default async function handler(req, res) {
  try {
    await cors(req, res);

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log("➡️ Incoming Body:", req.body);   // 🔴 Debug log

    const { amount, splitId, memberId, customer } = req.body;

    const payload = {
      order_amount: amount,
      order_currency: "INR",
      order_note: `Split:${splitId}`,
      order_id: `${splitId}_${memberId}_${Date.now()}`,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_email: customer?.email || "test@example.com",
        customer_phone: customer?.phone || "9999999999",
      },
    };

    console.log("➡️ Sending Payload to Cashfree:", payload);  // 🔴 Debug log

    const resp = await axios.post(
      "https://sandbox.cashfree.com/pg/orders",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET,
          "x-api-version": "2022-09-01",
        },
      }
    );

    console.log("✅ Cashfree Response:", resp.data);   // 🔴 Debug log

    return res.status(200).json({
      ok: true,
      order: resp.data,
      receipt: payload.order_id,
    });
  } catch (err) {
    console.error("❌ create-order error:", err.response?.data || err.message || err);
    return res.status(500).json({
      error: "Failed to create order",
      details: err.response?.data || err.message || err,
    });
  }
}
