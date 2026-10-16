const SERVICES = {
  resume: { title: "Resume refresh", usd: 5 },
  portfolio: { title: "Portfolio website", usd: 10 },
  bundle: { title: "Resume + portfolio", usd: 15 },
};

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function razorpay(path, env, init = {}) {
  const authorization = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.description || "Razorpay request failed.");
  return data;
}

async function createOrder(request, env, origin) {
  const { serviceId, currency } = await request.json();
  const service = SERVICES[serviceId];
  if (!service || !["USD", "INR"].includes(currency)) {
    return json({ error: "Choose a valid service and payment currency." }, 400, origin);
  }

  let amount;
  let conversion = null;
  if (currency === "USD") {
    amount = service.usd * 100;
  } else {
    const rateResponse = await fetch("https://api.frankfurter.dev/v2/rate/usd/inr");
    if (!rateResponse.ok) throw new Error("Could not get the latest USD to INR reference rate.");
    const rateData = await rateResponse.json();
    const rate = Number(rateData.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("The USD to INR reference rate was invalid.");
    amount = Math.round(service.usd * rate * 100);
    conversion = { usd: service.usd, rate, rateDate: rateData.date };
  }

  const order = await razorpay("/orders", env, {
    method: "POST",
    body: JSON.stringify({
      amount,
      currency,
      receipt: `${serviceId}-${crypto.randomUUID().slice(0, 12)}`,
      notes: { service_id: serviceId, service_title: service.title, display_usd: String(service.usd), ...(conversion || {}) },
    }),
  });

  return json({
    key: env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    serviceId,
    title: service.title,
    displayUsd: service.usd,
    conversion,
  }, 200, origin);
}

async function verifyPayment(request, env, origin) {
  const { serviceId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = await request.json();
  if (!SERVICES[serviceId] || !orderId || !paymentId || !signature) {
    return json({ error: "Payment details are incomplete." }, 400, origin);
  }

  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  if (!constantTimeEqual(expected, signature)) return json({ error: "Payment signature could not be verified." }, 400, origin);

  const [order, payment] = await Promise.all([
    razorpay(`/orders/${encodeURIComponent(orderId)}`, env),
    razorpay(`/payments/${encodeURIComponent(paymentId)}`, env),
  ]);
  const service = SERVICES[serviceId];
  const matchingPayment = payment.order_id === orderId
    && payment.status === "captured"
    && payment.amount === order.amount
    && payment.currency === order.currency
    && order.notes?.service_id === serviceId;
  if (!matchingPayment) return json({ error: "Payment is not captured for this service yet." }, 402, origin);

  return json({ verified: true, serviceId, serviceTitle: service.title }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN;
    if (!allowedOrigin || origin !== allowedOrigin) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/orders") return await createOrder(request, env, allowedOrigin);
      if (request.method === "POST" && url.pathname === "/api/verify") return await verifyPayment(request, env, allowedOrigin);
      return json({ error: "Not found." }, 404, allowedOrigin);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Payment service unavailable." }, 502, allowedOrigin);
    }
  },
};
