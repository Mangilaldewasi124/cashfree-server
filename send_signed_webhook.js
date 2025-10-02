// send_signed_webhook.js
const axios = require("axios");
const crypto = require("crypto");

const ngrokUrl = process.env.NGROK_URL || "https://cherie-nonprovincial-impolitely.ngrok-free.dev/cashfree-webhook";
const secret = process.env.CASHFREE_WEBHOOK_SECRET || "mysecret123"; // should match .env

const orderId = process.argv[2] || "SPLITID_MEMBERID_12345";

const payload = {
  event: "PAYMENT.SUCCESS",
  data: {
    payment: {
      order_id: orderId,
      payment_status: "SUCCESS",
      payment_id: "CF_TEST_123"
    }
  }
};

const raw = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");

axios.post(ngrokUrl, raw, {
  headers: {
    "Content-Type": "application/json",
    "x-webhook-signature": sig
  },
}).then(r => {
  console.log("Webhook delivered. status:", r.status, r.data);
}).catch(e => {
  console.error("Send webhook failed:", e.response?.data || e.message);
});
