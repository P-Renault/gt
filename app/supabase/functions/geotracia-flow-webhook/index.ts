import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;
const env = (key: string) => (Deno.env.get(key) ?? "").trim();
const reply = (body: JsonObject, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function flowSign(params: Record<string, string>, secret: string): Promise<string> {
  const canonical = Object.keys(params).sort().map((key) => key + params[key]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readToken(req: Request): Promise<string> {
  const queryToken = new URL(req.url).searchParams.get("token");
  if (queryToken?.trim()) return queryToken.trim();
  const raw = (await req.text().catch(() => "")).trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as JsonObject;
    if (typeof parsed.token === "string") return parsed.token.trim();
  } catch { /* form-urlencoded below */ }
  return (new URLSearchParams(raw).get("token") ?? "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const flowApi = env("FLOW_API_URL").replace(/\/+$/, "");
    const apiKey = env("FLOW_API_KEY");
    const secret = env("FLOW_SECRET_KEY");
    const projectUrl = env("PROJECT_URL").replace(/\/+$/, "");
    const serviceKey = env("PROJECT_SERVICE_ROLE_KEY");
    if (![flowApi, apiKey, secret, projectUrl, serviceKey].every(Boolean))
      return reply({ ok: false, error: "CONFIG_MISSING" }, 500);
    if (flowApi !== "https://www.flow.cl/api")
      return reply({ ok: false, error: "FLOW_API_URL_NOT_ALLOWED" }, 500);

    const token = await readToken(req);
    if (!token || token.length > 500) return reply({ ok: false, error: "FLOW_TOKEN_REQUIRED" }, 400);

    // La fuente de verdad es la consulta servidor-a-servidor a Flow, no el navegador ni el webhook entrante.
    const params = { apiKey, token };
    const statusUrl = new URL(`${flowApi}/payment/getStatus`);
    statusUrl.searchParams.set("apiKey", apiKey);
    statusUrl.searchParams.set("token", token);
    statusUrl.searchParams.set("s", await flowSign(params, secret));

    const flowResponse = await fetch(statusUrl, { signal: AbortSignal.timeout(20000) });
    const raw = await flowResponse.text();
    let flowData: JsonObject;
    try { flowData = JSON.parse(raw) as JsonObject; }
    catch { return reply({ ok: false, error: "FLOW_INVALID_RESPONSE" }, 502); }
    if (!flowResponse.ok) return reply({ ok: false, error: "FLOW_STATUS_REQUEST_FAILED" }, 502);

    const commerceOrder = String(flowData.commerceOrder ?? "");
    const flowOrder = String(flowData.flowOrder ?? "");
    const status = Number(flowData.status);
    const amount = Number(flowData.amount);
    const currency = String(flowData.currency ?? "");
    if (!commerceOrder || !flowOrder || ![1, 2, 3, 4].includes(status) ||
        !Number.isSafeInteger(amount) || amount <= 0 || currency !== "CLP") {
      return reply({ ok: false, error: "FLOW_DATA_INVALID" }, 409);
    }

    const db = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: payment, error: lookupError } = await db.from("geotracia_payments")
      .select("id,organization_id,user_id,provider_order_id,provider_token,provider_payload,amount_clp,currency,status")
      .eq("provider_token", token).maybeSingle();
    if (lookupError) {
      console.error("geotracia-flow-webhook lookup", lookupError.code ?? lookupError.message);
      return reply({ ok: false, error: "PAYMENT_LOOKUP_FAILED" }, 500);
    }
    if (!payment) return reply({ ok: false, error: "PAYMENT_NOT_FOUND" }, 404);

    const checkoutPayload = (payment.provider_payload ?? {}) as JsonObject;
    const storedFlowOrder = String(checkoutPayload.flowOrder ?? "");
    if (payment.provider_order_id !== commerceOrder ||
        Number(payment.amount_clp) !== amount || payment.currency !== currency ||
        (!storedFlowOrder || storedFlowOrder !== flowOrder)) {
      console.error("geotracia-flow-webhook mismatch", { payment_id: payment.id });
      return reply({ ok: false, error: "PAYMENT_MISMATCH" }, 409);
    }

    const { data: processed, error: processError } = await db.rpc("process_geotracia_flow_payment", {
      p_provider_token: token,
      p_flow_status: status,
      p_payload: flowData,
    });
    if (processError) {
      console.error("process_geotracia_flow_payment", processError.code ?? processError.message);
      return reply({ ok: false, error: "PAYMENT_PROCESSING_FAILED" }, 500);
    }

    return reply({
      ok: true,
      received: true,
      payment_id: payment.id,
      payment_status: String(processed?.payment_status ?? payment.status),
      already_processed: processed?.already_processed === true,
      flow_status: status,
    });
  } catch (error) {
    console.error("geotracia-flow-webhook", error instanceof Error ? error.message : "UNKNOWN");
    return reply({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
