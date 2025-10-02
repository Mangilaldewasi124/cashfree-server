// api/create-order.js
import Cors from "cors";
import initMiddleware from "next-connect"; // we'll use a tiny wrapper pattern
import axios from "axios";
import admin from "firebase-admin";

/**
 * Lightweight init middleware — small helper to use cors easily in serverless
 */
function initCors() {
  const cors = Cors({ origin: true, methods: ["POST", "OPTIONS"] });
  return function (req, res) {
    return new Promise((resolve, reject) => {
      cors(req, res, (result) => (result instanceof Error ? reject(result) : resolve(result)));
    });
  };
}

const corsMiddleware = initCors();

// init firebase admin once
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT_BASE64 env var");
  } else {
    try {
      const saJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
      const sa = JSON.parse(saJson);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log("Firebase admin initialized in create-order");
    } catch (e) {
      console.error("Failed to init firebase in create-order:", e);
    }
  }
}
const db = admin.firestore();

export default async function handler(req, res) {
  await corsMiddleware(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { amount, splitId, memberId, customer = {} } = req.body || {};
    if (!amount || !splitId || !memberId) return res.status(400).json({ error: "missing_params" });

    const order_id = `${splitId}_${memberId}_${Date.now()}`;

    // Cashfree payload
    const payload = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id,
      customer_details: {
        customer_id: customer.id || `cust_${Date.now()}`,
        customer_email: customer.email || "test@example.com",
        customer_phone: customer.phone || "9999999999",
      },
      order_note: `Split:${splitId}`
    };

    const headers = {
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET,
      "x-api-version": process.env.CASHFREE_API_VERSION || "2023-01-01"
    };

    const CASHFREE_API_BASE = process.env.CASHFREE_API_BASE || "https://sandbox.cashfree.com/pg";

    const resp = await axios.post(`${CASHFREE_API_BASE}/orders`, payload, { headers, timeout: 20000 });

    // save quick record
    try {
      await db.collection("payments").doc(order_id).set({
        splitId,
        memberId,
        orderId: order_id,
        orderResp: resp.data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn("payments write failed", e.message || e);
    }

    return res.json({ ok: true, order: resp.data, receipt: order_id });
  } catch (err) {
    console.error("create-order err:", err.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: "create_order_failed", detail: err.response?.data || err.message });
  }
}
