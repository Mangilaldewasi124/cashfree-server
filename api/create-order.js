// api/create-order.js
export default async function handler(req, res) {
  try {
    console.log("✅ minimal handler hit", { method: req.method, body: req.body });
    // simple check: only POST allowed
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }
    return res.status(200).json({ ok: true, msg: "minimal create-order ok", received: req.body || null });
  } catch (err) {
    console.error("minimal handler error", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
