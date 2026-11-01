import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
type Obj = Record<string, unknown>;
const json = (body: Obj, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function flowSign(params: Record<string, string>, secret: string) {
  const canonical = Object.keys(params).sort().map((key) => key + params[key]).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeFlowError(data: Obj) {
  return {
    flow_http_status: 400,
    flow_error_code: String(data.code ?? data.errorCode ?? data.error ?? "UNKNOWN").slice(0, 100),
    flow_error_message: String(data.message ?? data.msg ?? data.description ?? "Flow rechazó la consulta").slice(0, 300),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  let stage = "configuration";
  try {
    const projectUrl = env("PROJECT_URL").replace(/\/+$/, "");
    const serviceKey = env("PROJECT_SERVICE_ROLE_KEY");
    const apiKey = env("FLOW_API_KEY");
    const secret = env("FLOW_SECRET_KEY");
    const apiUrl = env("FLOW_API_URL").replace(/\/+$/, "");

    if (![projectUrl, serviceKey, apiKey, secret, apiUrl].every(Boolean))
      return json({ ok: false, error: "FLOW_CONFIG_MISSING", stage }, 500);
    if (apiUrl !== "https://www.flow.cl/api")
      return json({ ok: false, error: "FLOW_API_URL_NOT_ALLOWED", stage }, 500);

    stage = "authentication";
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer "))
      return json({ ok: false, error: "AUTHORIZATION_REQUIRED", stage }, 401);

    const db = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } =
      await db.auth.getUser(authorization.slice(7).trim());
    if (authError || !authData.user)
      return json({ ok: false, error: "INVALID_AUTHENTICATION", stage }, 401);

    stage = "request_validation";
    const body = await req.json().catch(() => null) as Obj | null;
    const paymentId = String(body?.payment_id ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId))
      return json({ ok: false, error: "INVALID_PAYMENT_ID", stage }, 400);

    stage = "payment_lookup";
    const { data: payment, error: paymentError } = await db
      .from("geotracia_payments")
      .select("id,organization_id,user_id,provider_order_id,provider_token,amount_clp,currency,status")
      .eq("id", paymentId)
      .eq("provider", "flow")
      .maybeSingle();
    if (paymentError) {
      console.error("geotracia-flow-get-status payment lookup", paymentError.message);
      return json({ ok: false, error: "PAYMENT_LOOKUP_FAILED", stage }, 500);
    }
    if (!payment) return json({ ok: false, error: "PAYMENT_NOT_FOUND", stage }, 404);
    if (!payment.provider_token || !payment.provider_order_id)
      return json({ ok: false, error: "PAYMENT_FLOW_DATA_INCOMPLETE", stage }, 409);

    stage = "organization_membership";
    const { data: membership, error: membershipError } = await db
      .from("members")
      .select("role,active")
      .eq("organization_id", payment.organization_id)
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (membershipError) {
      console.error("geotracia-flow-get-status membership lookup", membershipError.message);
      return json({ ok: false, error: "MEMBERSHIP_QUERY_FAILED", stage }, 500);
    }
    if (!membership || !["owner", "admin"].includes(String(membership.role ?? "").toLowerCase()))
      return json({ ok: false, error: "ORGANIZATION_ACCESS_DENIED", stage }, 403);

    stage = "flow_get_status";
    const params = { apiKey, token: String(payment.provider_token) };
    const requestUrl = new URL(`${apiUrl}/payment/getStatus`);
    requestUrl.searchParams.set("apiKey", apiKey);
    requestUrl.searchParams.set("token", String(payment.provider_token));
    requestUrl.searchParams.set("s", await flowSign(params, secret));

    let response: Response;
    try {
      response = await fetch(requestUrl, { signal: AbortSignal.timeout(20000) });
    } catch (error) {
      console.error("geotracia-flow-get-status network", error instanceof Error ? error.message : "UNKNOWN");
      return json({ ok: false, error: "FLOW_NETWORK_ERROR", stage }, 502);
    }

    const raw = await response.text();
    let flowData: Obj;
    try {
      flowData = JSON.parse(raw) as Obj;
    } catch {
      return json({ ok: false, error: "FLOW_INVALID_RESPONSE", stage, flow_http_status: response.status }, 502);
    }
    if (!response.ok) {
      const flowError = safeFlowError(flowData);
      console.error("geotracia-flow-get-status rejected", {
        http_status: response.status,
        flow_error_code: flowError.flow_error_code,
        flow_error_message: flowError.flow_error_message,
      });
      return json({
        ok: false,
        error: "FLOW_STATUS_REQUEST_FAILED",
        stage,
        ...flowError,
      }, 502);
    }

    stage = "flow_data_validation";
    const commerceOrder = String(flowData.commerceOrder ?? "");
    const flowStatus = Number(flowData.status);
    const amount = Number(flowData.amount);
    const currency = String(flowData.currency ?? "");
    if (!commerceOrder || ![1, 2, 3, 4].includes(flowStatus) ||
        !Number.isSafeInteger(amount) || amount <= 0 || currency !== "CLP") {
      return json({ ok: false, error: "FLOW_DATA_INVALID", stage }, 502);
    }
    if (commerceOrder !== payment.provider_order_id ||
        amount !== Number(payment.amount_clp) ||
        currency !== payment.currency) {
      console.error("geotracia-flow-get-status payment mismatch", {
        payment_id: payment.id,
        commerce_order_matches: commerceOrder === payment.provider_order_id,
        amount_matches: amount === Number(payment.amount_clp),
        currency_matches: currency === payment.currency,
      });
      return json({ ok: false, error: "PAYMENT_MISMATCH", stage }, 409);
    }

    stage = "payment_processing";
    const { data: processed, error: processError } = await db.rpc(
      "process_geotracia_flow_payment",
      {
        p_provider_token: String(payment.provider_token),
        p_flow_status: flowStatus,
        p_payload: flowData,
      },
    );
    if (processError) {
      console.error("geotracia-flow-get-status RPC", processError.message);
      return json({ ok: false, error: "PAYMENT_PROCESSING_FAILED", stage }, 500);
    }

    return json({
      ok: true,
      payment_id: payment.id,
      payment_status: String(processed?.payment_status ?? payment.status),
      flow_status: flowStatus,
      already_processed: Boolean(processed?.already_processed ?? false),
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("geotracia-flow-get-status", error instanceof Error ? error.message : "UNKNOWN");
    return json({ ok: false, error: "INTERNAL_ERROR", stage }, 500);
  }
});
