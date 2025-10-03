import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { amount, splitId, memberId, customer } = req.body;

    const resp = await axios.post(
      "https://sandbox.cashfree.com/pg/orders",
      {
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: memberId,
          customer_phone: customer.phone,
          customer_email: customer.email || "test@example.com",
        },
        order_meta: {
          return_url: "https://example.com/success?order_id={order_id}",
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET,
          "x-api-version": "2023-08-01",   // <== important
        },
      }
    );

    return res.status(200).json({ ok: true, order: resp.data });
  } catch (err) {
    console.error("create-order error", err.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: "cashfree_create_failed",
      details: err.response?.data || err.message,
    });
  }
}
