// server.js
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// --- REQUIRED ENV VARS (set these in Vercel)
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET = process.env.CASHFREE_SECRET;
const CASHFREE_API_BASE = process.env.CASHFREE_API_BASE || "https://sandbox.cashfree.com/pg";
const WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET || "please_change_me";

// FIREBASE SERVICE ACCOUNT (base64 string expected)
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT_BASE64 env var");
} else {
  try {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    const sa = JSON.parse(json);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    console.log("Firebase admin initialized");
  } catch (err) {
    console.error("Failed to init firebase-admin:", err);
  }
}

const db = admin.firestore();

// Utility: create Cashfree order
async function createCashfreeOrder({ amount, order_id, customer }) {
  const payload = {
    order_amount: Number(amount),
    order_currency: "INR",
    order_id,
    customer_details: {
      customer_id: customer?.id || `cust_${Date.now()}`,
      customer_email: customer?.email || "test@example.com",
      customer_phone: customer?.phone || "9999999999",
    },
    order_note: payloadNote(order_id)
  };

  // include api-version header if Cashfree demands it
  const headers = {
    "Content-Type": "application/json",
    "x-client-id": CASHFREE_APP_ID,
    "x-client-secret": CASHFREE_SECRET,
    "x-api-version": "2023-01-01"
  };

 const resp = await axios.post(`${CASHFREE_API_BASE}/orders`, payload, {
  headers: {
    "Content-Type": "application/json",
    "x-client-id": CASHFREE_APP_ID,
    "x-client-secret": CASHFREE_SECRET,
    "x-api-version": "2023-08-01"   // 👈 यह लाइन जोड़नी है
  }
});

  return resp.data;
}

function payloadNote(order_id) {
  return `order:${order_id}`;
}

// create-order endpoint used by app
app.post("/create-order", async (req, res) => {
  try {
    const { amount, splitId, memberId, customer = {} } = req.body;
    if (!amount || !splitId || !memberId) return res.status(400).json({ ok: false, error: "missing_params" });

    const order_id = `${splitId}_${memberId}_${Date.now()}`;

    console.log("Creating order:", { order_id, amount });

    const orderResp = await createCashfreeOrder({ amount, order_id, customer });

    // store order record to Firestore (optional but useful)
    try {
      await db.collection("payments").doc(order_id).set({
        splitId,
        memberId,
        orderResp,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn("failed to write payment doc:", e.message || e);
    }

    return res.json({ ok: true, order: orderResp, receipt: order_id });
  } catch (err) {
    console.error("create-order err:", err.response?.data || err.message || err);
    return res.status(500).json({ ok: false, error: "create_order_failed", detail: err.response?.data || err.message });
  }
});

// webhook endpoint (Cashfree -> calls this)
app.post("/cashfree-webhook", async (req, res) => {
  try {
    const signature = req.headers["x-webhook-signature"] || req.headers["x-webhook-sign"];
    const rawBody = JSON.stringify(req.body);
    const computed = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

    if (!signature || signature !== computed) {
      console.warn("Invalid webhook signature", signature, "computed:", computed);
      return res.status(401).json({ ok: false, reason: "invalid_signature" });
    }

    const ev = req.body;
    console.log("Webhook received:", JSON.stringify(ev).slice(0, 200));

    // handle payment success
    const payment = ev?.data?.payment;
    if (ev?.event === "PAYMENT.SUCCESS" || payment?.payment_status === "SUCCESS") {
      const order_id = payment.order_id || payment.orderId || "";
      // our order_id format: splitId_memberId_timestamp
      const [splitId, memberId] = order_id.split("_");

      if (!splitId || !memberId) {
        console.warn("Webhook order_id parse failed:", order_id);
        return res.json({ ok: true, note: "no_action" });
      }

      // update Firestore split doc: mark matching member paid
      const splitRef = db.collection("splits").doc(splitId);
      const snap = await splitRef.get();
      if (!snap.exists) {
        console.warn("split not found:", splitId);
        return res.json({ ok: true, note: "split_not_found" });
      }

      const splitDoc = snap.data();
      const members = (splitDoc.members || []).map(m => {
        if (m.id === memberId && !m.paid) {
          return {
            ...m,
            paid: true,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paidBy: "Cashfree",
            paymentInfo: payment
          };
        }
        return m;
      });

      await splitRef.update({ members });
      console.log("Marked member paid:", splitId, memberId);
      return res.json({ ok: true, note: "member_updated" });
    }

    // otherwise just acknowledge
    return res.json({ ok: true });
  } catch (err) {
    console.error("webhook handler err:", err);
    return res.status(500).json({ ok: false });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Server listening on port", port));
