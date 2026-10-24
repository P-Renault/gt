
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = (Deno.env.get("GEOTRACIA_SITE_URL") ?? "").replace(/\/$/, "");
const ALLOWED_ORIGIN = Deno.env.get("GEOTRACIA_ALLOWED_ORIGIN") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedRoles = ["viewer", "inspector", "manager", "admin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response(405, { ok: false, error: "Método no permitido." });
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return response(500, {
      ok: false,
      error: "Falta configurar la función en el servidor.",
    });
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return response(401, { ok: false, error: "Debes iniciar sesión." });
  }

  const token = authorization.slice(7);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } =
    await caller.auth.getUser(token);
  const user = userData.user;

  if (userError || !user?.id || !user.email) {
    return response(401, { ok: false, error: "La sesión no es válida." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return response(400, { ok: false, error: "El JSON enviado no es válido." });
  }

  const action = String(body.action ?? "");

  // ------------------------------------------------------
  // INVITAR A UN NUEVO USUARIO
  // ------------------------------------------------------
  if (action === "invite") {
    const organizationId = String(body.organization_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "viewer");

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(organizationId)) {
      return response(400, {
        ok: false,
        error: "El identificador de organización no es válido.",
      });
    }

    if (
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return response(400, {
        ok: false,
        error: "Introduce un correo electrónico válido.",
      });
    }

    if (!allowedRoles.includes(role)) {
      return response(400, {
        ok: false,
        error: "El rol solicitado no está permitido.",
      });
    }

    if (email === user.email.toLowerCase()) {
      return response(400, {
        ok: false,
        error: "No puedes invitar tu propio correo.",
      });
    }

    // Validar membresía activa del solicitante.
    const { data: membership, error: membershipError } = await admin
      .from("members")
      .select("role, active")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (membershipError) {
      return response(500, {
        ok: false,
        error: "No se pudo validar tu membresía.",
      });
    }

    if (
      !membership ||
      !["owner", "admin"].includes(String(membership.role))
    ) {
      return response(403, {
        ok: false,
        error: "Solo el owner o un admin activo puede invitar usuarios.",
      });
    }

    if (membership.role !== "owner" && role === "admin") {
      return response(403, {
        ok: false,
        error: "Solo el owner puede invitar administradores.",
      });
    }

    // Verificar suscripción y vigencia.
    const { data: subscription, error: subError } = await admin
      .from("geotracia_organization_subscriptions")
      .select("status, current_period_end, operators_limit")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (subError) {
      return response(500, {
        ok: false,
        error: "No se pudo comprobar la suscripción.",
      });
    }

    if (
      !subscription ||
      !["trial", "trialing", "active"].includes(String(subscription.status)) ||
      (
        subscription.current_period_end &&
        new Date(subscription.current_period_end).getTime() < Date.now()
      )
    ) {
      return response(403, {
        ok: false,
        error: "La suscripción no permite invitar usuarios actualmente.",
      });
    }

    // Comprobar cupo de miembros activos.
    const { count, error: countError } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("active", true);

    if (countError) {
      return response(500, {
        ok: false,
        error: "No se pudo comprobar el límite de usuarios.",
      });
    }

    if (
      subscription.operators_limit != null &&
      (count ?? 0) >= Number(subscription.operators_limit)
    ) {
      return response(403, {
        ok: false,
        error: "La organización alcanzó el límite de usuarios del plan.",
      });
    }

    // Evitar invitar cuentas ya registradas.
    // Para organizaciones grandes, sustituir esta búsqueda por
    // una comprobación paginada o un mecanismo administrativo específico.
    const { data: usersData, error: usersError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (usersError) {
      return response(500, {
        ok: false,
        error: "No se pudo comprobar si el correo ya está registrado.",
      });
    }

    const existingUser = usersData.users.find(
      (item) => (item.email ?? "").toLowerCase() === email,
    );

    if (existingUser) {
      const { data: existingMember, error: memberError } = await admin
        .from("members")
        .select("id, active")
        .eq("organization_id", organizationId)
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (memberError) {
        return response(500, {
          ok: false,
          error: "No se pudo verificar la membresía existente.",
        });
      }

      if (existingMember) {
        return response(409, {
          ok: false,
          error: existingMember.active
            ? "Esta cuenta ya pertenece a la organización."
            : "La cuenta tiene una membresía inactiva. Debe revisarse desde la gestión de miembros.",
        });
      }

      return response(409, {
        ok: false,
        error:
          "El correo ya tiene una cuenta Geotracia. Utiliza la opción para añadir una cuenta registrada.",
      });
    }

    if (!SITE_URL) {
      return response(500, {
        ok: false,
        error: "Configura GEOTRACIA_SITE_URL en los secretos de la función.",
      });
    }

    // Crear el registro pendiente.
    const { data: invitation, error: insertError } = await admin
      .from("geotracia_organization_invitations")
      .insert({
        organization_id: organizationId,
        email,
        role,
        invited_by: user.id,
      })
      .select("id, expires_at")
      .single();

    if (insertError) {
      return response(
        insertError.code === "23505" ? 409 : 500,
        {
          ok: false,
          error: insertError.code === "23505"
            ? "Ya existe una invitación pendiente para este correo."
            : "No se pudo crear la invitación.",
        },
      );
    }

    // Enviar invitación real al flujo de activación de la aplicación (/app/).
    // GEOTRACIA_SITE_URL puede configurarse como https://geotracia.cl o incluir /app/.
    const appUrl = new URL(SITE_URL);
    const currentPath = appUrl.pathname.replace(/\/+$/, "");
    appUrl.pathname = currentPath.endsWith("/app") ? `${currentPath}/` : `${currentPath}/app/`;
    appUrl.search = "?auth=invite";
    appUrl.hash = "";
    const redirectTo = appUrl.toString();

    const { error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          geotracia_invitation_id: invitation.id,
        },
      });

    if (inviteError) {
      await admin
        .from("geotracia_organization_invitations")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", invitation.id);

      return response(502, {
        ok: false,
        error:
          "No se pudo enviar el correo. Revisa SMTP y la configuración de Supabase Auth.",
      });
    }

    await admin
      .from("geotracia_organization_invitations")
      .update({
        auth_invite_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);

    return response(200, {
      ok: true,
      message: "Invitación enviada correctamente.",
      expires_at: invitation.expires_at,
    });
  }

  // ------------------------------------------------------
  // ACEPTAR INVITACIÓN CON LA CUENTA AUTENTICADA
  // ------------------------------------------------------
  if (action === "accept") {
    if (!user.email_confirmed_at) {
      return response(403, {
        ok: false,
        error: "Debes confirmar tu correo antes de aceptar la invitación.",
      });
    }

    const invitationId = String(
      user.user_metadata?.geotracia_invitation_id ?? "",
    );

    let query = admin
      .from("geotracia_organization_invitations")
      .select(
        "id, organization_id, email, role, expires_at, status, organizations(name)",
      )
      .eq("email", user.email.toLowerCase())
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (invitationId) {
      query = query.eq("id", invitationId);
    }

    const { data: invitations, error: invitationError } = await query;

    if (invitationError) {
      return response(500, {
        ok: false,
        error: "No se pudo consultar la invitación.",
      });
    }

    const invitation = invitations?.[0];

    if (!invitation) {
      return response(200, {
        ok: true,
        accepted: false,
        message: "No se encontró una invitación pendiente para esta cuenta.",
      });
    }

    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return response(403, {
        ok: false,
        error: "La invitación no corresponde al correo autenticado.",
      });
    }

    // Verificar si ya existe una membresía.
    const { data: existingMember, error: memberError } = await admin
      .from("members")
      .select("id, active")
      .eq("organization_id", invitation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) {
      return response(500, {
        ok: false,
        error: "No se pudo comprobar la membresía.",
      });
    }

    if (existingMember?.active) {
      return response(409, {
        ok: false,
        error: "La cuenta ya tiene acceso activo a esta organización.",
      });
    }

    if (existingMember && !existingMember.active) {
      return response(409, {
        ok: false,
        error: "La membresía está inactiva. Un administrador debe revisarla.",
      });
    }

    // Comprobar de nuevo la suscripción antes de aceptar.
    const { data: subscription, error: subError } = await admin
      .from("geotracia_organization_subscriptions")
      .select("status, current_period_end, operators_limit")
      .eq("organization_id", invitation.organization_id)
      .maybeSingle();

    if (subError) {
      return response(500, {
        ok: false,
        error: "No se pudo verificar la suscripción.",
      });
    }

    if (
      !subscription ||
      !["trial", "trialing", "active"].includes(String(subscription.status)) ||
      (
        subscription.current_period_end &&
        new Date(subscription.current_period_end).getTime() < Date.now()
      )
    ) {
      return response(403, {
        ok: false,
        error: "La suscripción no permite aceptar integrantes actualmente.",
      });
    }

    const { count, error: countError } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", invitation.organization_id)
      .eq("active", true);

    if (countError) {
      return response(500, {
        ok: false,
        error: "No se pudo verificar el cupo de usuarios.",
      });
    }

    if (
      subscription.operators_limit != null &&
      (count ?? 0) >= Number(subscription.operators_limit)
    ) {
      return response(403, {
        ok: false,
        error: "La organización alcanzó el límite de usuarios de su plan.",
      });
    }

    // Crear la membresía con el rol autorizado guardado en la invitación.
    const { error: addError } = await admin.from("members").insert({
      organization_id: invitation.organization_id,
      user_id: user.id,
      role: invitation.role,
      active: true,
    });

    if (addError) {
      return response(500, {
        ok: false,
        error: "No se pudo crear la membresía. Revisa el esquema de members.",
      });
    }

    const { error: updateError } = await admin
      .from("geotracia_organization_invitations")
      .update({
        status: "accepted",
        accepted_by: user.id,
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (updateError) {
      return response(500, {
        ok: false,
        error: "La membresía se creó, pero no se pudo actualizar la invitación.",
      });
    }

    const organization = Array.isArray(invitation.organizations)
      ? invitation.organizations[0]
      : invitation.organizations;

    return response(200, {
      ok: true,
      accepted: true,
      organization_id: invitation.organization_id,
      organization_name: organization?.name ?? "Geotracia",
      role: invitation.role,
    });
  }

  return response(400, {
    ok: false,
    error: "Acción no reconocida. Usa invite o accept.",
  });
});
