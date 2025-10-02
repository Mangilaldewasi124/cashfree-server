// api/cashfree-webhook.js
import Cors from "cors";
import axios from "axios";
import admin from "firebase-admin";
import crypto from "crypto";

function initCors() {
  const cors = Cors({ origin: true, methods: ["POST", "OPTIONS"] });
  return function (req, res) {
    return new Promise((resolve, reject) => {
      cors(req, res, (result) => (result instanceof Error ? reject(result) : resolve(result)));
    });
  };
}
const corsMiddleware = initCors();

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT_BASE64 env var");
  } else {
    try {
      const saJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
      const sa = JSON.parse(saJson);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log("Firebase admin initialized in webhook");
    } catch (e) {
      console.error("Failed to init firebase in webhook:", e);
    }
  }
}
const db = admin.firestore();

export default async function handler(req, res) {
  await corsMiddleware(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const raw = JSON.stringify(req.body);
    const headerSig = req.headers["x-webhook-signature"] || req.headers["x-webhook-sign"];
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || "";
    const computed = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    // If you didn't set signature in Cashfree, skip strict check (but recommended to set it)
    if (headerSig && headerSig !== computed) {
      console.warn("Invalid webhook signature", headerSig, computed);
      return res.status(401).json({ ok: false, reason: "invalid_signature" });
    }

    const ev = req.body;
    console.log("Webhook received:", ev?.event || "no-event");

    const payment = ev?.data?.payment;
    if ((ev?.event === "PAYMENT.SUCCESS") || (payment?.payment_status === "SUCCESS")) {
      const order_id = payment?.order_id || "";
      const parts = order_id.split("_");
      const splitId = parts[0];
      const memberId = parts[1];

      if (!splitId || !memberId) {
        console.warn("Could not parse order_id:", order_id);
        return res.json({ ok: true, note: "no_action" });
      }

      const splitRef = db.collection("splits").doc(splitId);
      const snap = await splitRef.get();
      if (!snap.exists) {
        console.warn("Split not found:", splitId);
        return res.json({ ok: true, note: "split_not_found" });
      }

      const split = snap.data();
      const members = (split.members || []).map(m => {
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
      console.log("Marked paid:", splitId, memberId);
      return res.json({ ok: true, note: "member_updated" });
    }

    return res.json({ ok: true, note: "ignored_event" });
  } catch (err) {
    console.error("webhook handler err:", err);
    return res.status(500).json({ ok: false });
  }
}
