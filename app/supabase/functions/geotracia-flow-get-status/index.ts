import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (name: string) => (Deno.env.get(name) ?? "").trim();

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type JsonObject = Record<string, unknown>;

function json(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

async function flowSign(
  params: Record<string, string>,
  secret: string,
): Promise<string> {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => key + params[key])
    .join("");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(canonical),
  );

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function flowError(data: JsonObject): {
  code: string | null;
  message: string | null;
} {
  const code = data.code ?? data.errorCode ?? data.error ?? null;
  const message = data.message ?? data.msg ?? data.description ?? null;

  return {
    code: code === null ? null : String(code).slice(0, 100),
    message: message === null ? null : String(message).slice(0, 300),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let stage = "configuration";

  try {
    const projectUrl = env("PROJECT_URL").replace(/\/+$/, "");
    const serviceKey = env("PROJECT_SERVICE_ROLE_KEY");
    const apiKey = env("FLOW_API_KEY");
    const secret = env("FLOW_SECRET_KEY");
    const apiUrl = env("FLOW_API_URL").replace(/\/+$/, "");

    if (!projectUrl || !serviceKey || !apiKey || !secret || !apiUrl) {
      return json({ ok: false, error: "FLOW_CONFIG_MISSING", stage }, 500);
    }

    if (apiUrl !== "https://www.flow.cl/api") {
      return json({
        ok: false,
        error: "FLOW_API_URL_NOT_ALLOWED",
        stage,
      }, 500);
    }

    stage = "authentication";

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({
        ok: false,
        error: "AUTHORIZATION_REQUIRED",
        stage,
      }, 401);
    }

    const accessToken = authorization.slice(7).trim();
    if (!accessToken) {
      return json({
        ok: false,
        error: "AUTHORIZATION_REQUIRED",
        stage,
      }, 401);
    }

    const db = createClient(projectUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: auth, error: authError } = await db.auth.getUser(accessToken);
    if (authError || !auth.user) {
      console.error("geotracia-flow-get-status authentication", {
        message: authError?.message ?? "USER_NOT_FOUND",
      });
      return json({
        ok: false,
        error: "INVALID_AUTHENTICATION",
        stage,
      }, 401);
    }

    stage = "request_validation";

    const body = await req.json().catch(() => null) as JsonObject | null;
    const paymentId = String(body?.payment_id ?? "").trim();

    if (!paymentId) {
      return json({
        ok: false,
        error: "PAYMENT_ID_REQUIRED",
        stage,
      }, 400);
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
      return json({
        ok: false,
        error: "PAYMENT_ID_INVALID",
        stage,
      }, 400);
    }

    stage = "payment_lookup";

    const { data: payment, error: paymentError } = await db
      .from("geotracia_payments")
      .select(
        "id,user_id,provider,provider_token,provider_order_id,amount_clp,currency,status",
      )
      .eq("id", paymentId)
      .eq("user_id", auth.user.id)
      .eq("provider", "flow")
      .maybeSingle();

    if (paymentError) {
      console.error("geotracia-flow-get-status payment lookup", {
        code: paymentError.code,
        message: paymentError.message,
      });
      return json({
        ok: false,
        error: "PAYMENT_LOOKUP_FAILED",
        stage,
        db_code: paymentError.code ?? null,
      }, 500);
    }

    if (!payment) {
      return json({
        ok: false,
        error: "PAYMENT_NOT_FOUND",
        stage,
      }, 404);
    }

    const token = String(payment.provider_token ?? "").trim();
    const expectedOrder = String(payment.provider_order_id ?? "").trim();

    if (!token || !expectedOrder) {
      return json({
        ok: false,
        error: "FLOW_TRANSACTION_DATA_MISSING",
        stage,
        payment_id: payment.id,
      }, 409);
    }

    stage = "flow_get_status";

    const params: Record<string, string> = {
      apiKey,
      token,
    };

    const signature = await flowSign(params, secret);
    const query = new URLSearchParams({ ...params, s: signature });
    const response = await fetch(
      `${apiUrl}/payment/getStatus?${query.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      },
    );

    const raw = await response.text();
    let flowData: JsonObject;

    try {
      flowData = JSON.parse(raw) as JsonObject;
    } catch {
      console.error("geotracia-flow-get-status invalid response", {
        http_status: response.status,
      });
      return json({
        ok: false,
        error: "FLOW_INVALID_RESPONSE",
        stage,
        flow_http_status: response.status,
      }, 502);
    }

    if (!response.ok) {
      const error = flowError(flowData);
      console.error("geotracia-flow-get-status Flow rejected request", {
        http_status: response.status,
        flow_error_code: error.code,
        flow_error_message: error.message,
        payment_id: payment.id,
      });

      return json({
        ok: false,
        error: "FLOW_STATUS_REQUEST_FAILED",
        stage,
        flow_http_status: response.status,
        flow_error_code: error.code,
        flow_error_message: error.message,
      }, 502);
    }

    stage = "transaction_validation";

    const flowOrder = String(flowData.commerceOrder ?? "");
    const flowAmount = Number(flowData.amount);
    const flowCurrency = String(flowData.currency ?? "");
    const flowStatus = Number(flowData.status);

    if (
      flowOrder !== expectedOrder ||
      !Number.isSafeInteger(flowAmount) ||
      flowAmount !== Number(payment.amount_clp) ||
      flowCurrency !== String(payment.currency) ||
      ![1, 2, 3, 4].includes(flowStatus)
    ) {
      console.error("geotracia-flow-get-status transaction mismatch", {
        payment_id: payment.id,
        order_matches: flowOrder === expectedOrder,
        amount_matches: flowAmount === Number(payment.amount_clp),
        currency_matches: flowCurrency === String(payment.currency),
        valid_status: [1, 2, 3, 4].includes(flowStatus),
      });

      return json({
        ok: false,
        error: "FLOW_TRANSACTION_MISMATCH",
        stage,
        payment_id: payment.id,
      }, 409);
    }

    stage = "payment_processing";

    const { data: processed, error: processError } = await db.rpc(
      "process_geotracia_flow_payment",
      {
        p_provider_token: token,
        p_flow_status: flowStatus,
        p_payload: flowData,
      },
    );

    if (processError) {
      console.error("geotracia-flow-get-status RPC failed", {
        code: processError.code,
        message: processError.message,
        payment_id: payment.id,
      });

      return json({
        ok: false,
        error: "PAYMENT_PROCESSING_FAILED",
        stage,
        payment_id: payment.id,
        db_code: processError.code ?? null,
      }, 500);
    }

    const finalStatus = String(
      (processed as JsonObject | null)?.payment_status ?? payment.status,
    );

    return json({
      ok: true,
      payment_id: payment.id,
      payment_status: finalStatus,
      flow_status: flowStatus,
      already_processed: Boolean(
        (processed as JsonObject | null)?.already_processed,
      ),
    });
  } catch (error) {
    console.error("geotracia-flow-get-status", {
      stage,
      message: error instanceof Error ? error.message : String(error),
    });

    return json({
      ok: false,
      error: "INTERNAL_ERROR",
      stage,
    }, 500);
  }
});
