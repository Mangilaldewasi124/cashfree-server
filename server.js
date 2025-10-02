// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const admin = require("firebase-admin");
const path = require("path");

// ---------- config from env ----------
const PORT = process.env.PORT || 5000;
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;       // e.g. TEST...
const CASHFREE_SECRET = process.env.CASHFREE_SECRET;       // cf secret for API
const CASHFREE_API_BASE = process.env.CASHFREE_API_BASE || "https://sandbox.cashfree.com/pg"; // sandbox or prod
const WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET; // secret you set in Cashfree dashboard (prod)
// ---------- end config ----------

if (!CASHFREE_APP_ID || !CASHFREE_SECRET) {
  console.error("Missing Cashfree API credentials in env (CASHFREE_APP_ID, CASHFREE_SECRET).");
  process.exit(1);
}
if (!fs.existsSync(path.join(__dirname, "serviceAccountKey.json"))) {
  console.error("Missing serviceAccountKey.json for Firebase Admin in project root.");
  process.exit(1);
}

// initialize firebase-admin
const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();

// We need the raw body to verify signature. Save rawBody on request object.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer
    },
    limit: "1mb",
  })
);

// --- utility: generate receipt id (server uses this format) ---
function generateReceipt(splitId, memberId) {
  return `${splitId}_${memberId}_${Date.now()}`;
}

// --- create-order endpoint ---
app.post("/create-order", async (req, res) => {
  try {
    const { amount, splitId, memberId, customer } = req.body;
    if (!amount || !splitId || !memberId) return res.status(400).json({ error: "missing_fields" });

    const receipt = generateReceipt(splitId, memberId);

    const payload = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: receipt,
      order_note: `Split:${splitId}`,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_email: customer?.email || "no-reply@example.com",
        customer_phone: customer?.phone || "9999999999",
      },
    };

    const resp = await axios.post(`${CASHFREE_API_BASE}/orders`, payload, {
  headers: {
    "Content-Type": "application/json",
    "x-client-id": CASHFREE_APP_ID,
    "x-client-secret": CASHFREE_SECRET,
    "x-api-version": "2023-08-01"   // <-- add this line
  },
  timeout: 15000,
});


    // save to payments collection for record (doc id = receipt)
    await db.collection("payments").doc(receipt).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      receipt,
      splitId,
      memberId,
      amount: Number(amount),
      cashfreeRequest: payload,
      cashfreeResponse: resp.data,
    });

    return res.json({ ok: true, order: resp.data, receipt });
  } catch (err) {
    console.error("create-order err:", err.response?.data || err.message || err);
    return res.status(500).json({ error: "create_order_failed", details: err.response?.data || String(err.message) });
  }
});

// --- helper to verify signature (HMAC SHA256) ---
function verifySignature(rawBodyBuffer, headerSignature, secret) {
  if (!headerSignature || !secret) return false;
  // Cashfree uses hex HMAC SHA-256 (they call it x-webhook-signature). Adjust if docs say otherwise.
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBodyBuffer);
  const expected = hmac.digest("hex");
  // headerSignature might include prefix; compare lowercase
  return expected === String(headerSignature).trim();
}

// --- webhook endpoint with verification ---
app.post("/cashfree-webhook", async (req, res) => {
  try {
    // raw body buffer and parsed body are available
    const raw = req.rawBody || Buffer.from("");
    const body = req.body || {};
    console.log("Webhook raw body:", JSON.stringify(body));

    // Signature header (Cashfree may send header name x-webhook-signature or x-cashfree-signature)
    const headerSig = req.headers["x-webhook-signature"] || req.headers["x-cashfree-signature"] || req.headers["x-cf-signature"];

    // Verify signature when in production (require WEBHOOK_SECRET configured)
    if (process.env.NODE_ENV === "production" || !!WEBHOOK_SECRET) {
      if (!headerSig) {
        console.warn("Missing webhook signature header");
        return res.status(401).json({ ok: false, error: "missing_signature" });
      }
      if (!verifySignature(raw, headerSig, WEBHOOK_SECRET)) {
        console.warn("Invalid webhook signature");
        return res.status(401).json({ ok: false, error: "invalid_signature" });
      }
    } else {
      // If running non-prod and no secret configured, we still allow for dev/test
      console.log("Warning: WEBHOOK_SECRET not set — skipping signature verification (dev mode).");
    }

    // find the payment object robustly
    const payment = body?.data?.payment || body?.payload?.payment || body?.payment || body;
    const status = String(payment?.payment_status || payment?.status || body?.event || "").toLowerCase();

    const isSuccess = status.includes("success") || String(body?.event || "").toLowerCase().includes("payment.success");
    if (!isSuccess) {
      console.log("Webhook not a success event; ignoring.", status);
      return res.status(200).json({ ok: true, note: "ignored_not_success" });
    }

    const orderId = payment?.order_id || payment?.order?.order_id || body?.order_id;
    if (!orderId || !orderId.includes("_")) {
      console.warn("Malformed orderId in webhook:", orderId);
      return res.status(400).json({ ok: false, error: "bad_order_id" });
    }

    const parts = String(orderId).split("_");
    const splitId = parts[0];
    const memberId = parts[1];
    console.log("Webhook orderId parsed:", { orderId, splitId, memberId });

    // get split doc
    const splitRef = db.collection("splits").doc(splitId);
    const snap = await splitRef.get();
    if (!snap.exists) {
      console.warn("Split not found:", splitId);
      return res.status(404).json({ ok: false, error: "split_not_found" });
    }

    const split = snap.data();
    const members = Array.isArray(split.members) ? split.members : [];
    let updated = false;
    const now = admin.firestore.Timestamp.now();

    const newMembers = members.map((m) => {
      if (m && m.id === memberId) {
        if (m.paid) {
          console.log("Member already paid:", memberId);
          return m;
        }
        updated = true;
        return { ...m, paid: true, paidAt: now, paidBy: "Cashfree", paymentInfo: payment };
      }
      return m;
    });

    if (!updated) {
      console.warn("No matching member updated (maybe already paid or id mismatch).");
      // still respond OK to webhook so Cashfree doesn't retry forever
      return res.status(200).json({ ok: true, note: "no_member_updated" });
    }

    // Update the document
    await splitRef.update({ members: newMembers });
    console.log(`✅ Marked member ${memberId} paid for split ${splitId}`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).json({ ok: false, error: "processing_failed", details: String(err) });
  }
});

// simple health
app.get("/", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
