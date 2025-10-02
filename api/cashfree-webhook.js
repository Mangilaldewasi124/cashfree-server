// api/cashfree-webhook.js
import { Buffer } from "buffer";
import admin from "firebase-admin";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
let PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY; // this must contain \n newlines if set via UI

// Fix private key newlines if they were escaped
if (PRIVATE_KEY && PRIVATE_KEY.indexOf("\\n") !== -1) {
  PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");
}

// init firebase admin once (Vercel serverless cold start safe)
if (!admin.apps.length) {
  if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    console.warn("Firebase admin envs missing; webhook cannot write to Firestore.");
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: CLIENT_EMAIL,
        privateKey: PRIVATE_KEY,
      }),
    });
  }
}

const db = admin.apps.length ? admin.firestore() : null;

function verifySignature(secret, rawBody, header) {
  if (!secret) return false;
  // Cashfree signs with HMAC-SHA256 of body — header is usually "x-webhook-signature" or similar.
  // Many samples use x-webhook-signature with base64 HMAC. We support both forms.
  const crypto = await import("crypto");
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return header === hmac;
}

// Helper to parse raw body in Vercel serverless
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const rawStr = raw.toString("utf8");

    // signature header (Cashfree uses x-webhook-signature or x-cf-sign)
    const sigHeader = req.headers["x-webhook-signature"] || req.headers["x-cashfree-signature"] || req.headers["x-signature"];

    const secret = process.env.CASHFREE_WEBHOOK_SECRET;
    if (secret) {
      // verify signature
      const crypto = await import("crypto");
      const expected = crypto.createHmac("sha256", secret).update(rawStr).digest("base64");
      if (!sigHeader || sigHeader !== expected) {
        console.warn("webhook signature mismatch", { header: sigHeader, expectedPreview: expected?.slice?.(0,6) });
        return res.status(401).json({ ok: false, error: "invalid signature" });
      }
    }

    // parse JSON
    const payload = JSON.parse(rawStr);
    console.log("Webhook raw body:", payload);

    // check event type
    const ev = payload?.event || payload?.type || "";
    if (!ev.toUpperCase().includes("PAYMENT")) {
      return res.status(200).json({ ok: true, msg: "ignored event" });
    }

    const payment = payload?.data?.payment || payload?.data || {};
    const orderId = payment?.order_id || payment?.orderId || payment?.order || "";
    if (!orderId) {
      console.warn("no order id in webhook", payment);
      return res.status(400).json({ ok: false, error: "no_order_id" });
    }

    // Expect orderId format: <splitId>_<memberId>_<timestamp>
    const parts = orderId.split("_");
    if (parts.length < 2) {
      console.warn("order id format unexpected", orderId);
      return res.status(400).json({ ok: false, error: "order_id_format" });
    }
    const memberId = parts[parts.length - 2]; // second last
    const splitId = parts.slice(0, parts.length - 2).join("_"); // rest before memberId

    // If no Firestore configured, just return ok for testing
    if (!db) {
      console.log("No Firestore available — webhook parsed", { splitId, memberId, orderId });
      return res.status(200).json({ ok: true, note: "no_db", splitId, memberId });
    }

    // Load split document
    const splitRef = db.collection("splits").doc(splitId);
    const snap = await splitRef.get();
    if (!snap.exists) {
      console.warn("no split doc for id:", splitId);
      return res.status(200).json({ ok: true, note: "no_split" });
    }
    const split = snap.data();

    // find member
    const members = Array.isArray(split.members) ? split.members : [];
    const idx = members.findIndex((m) => String(m.id) === String(memberId) || String(m.phone) === String(memberId));
    if (idx === -1) {
      // try find by id partial match
      const alt = members.findIndex((m) => memberId && m.id && m.id.includes(memberId));
      if (alt === -1) {
        console.warn("no matching member", { splitId, memberId });
        return res.status(200).json({ ok: true, note: "no_member" });
      }
    }

    const targetIndex = idx === -1 ? alt : idx;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const memberUpdate = {
      ...members[targetIndex],
      paid: true,
      paidAt: now,
      paidBy: "Cashfree",
      paymentInfo: payment,
    };

    const newMembers = [...members];
    newMembers[targetIndex] = memberUpdate;

    await splitRef.update({ members: newMembers });

    console.log("Member updated", { splitId, memberId });
    return res.status(200).json({ ok: true, note: "member_updated" });
  } catch (err) {
    console.error("webhook handler err", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
