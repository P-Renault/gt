import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("GEOTRACIA_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Método no permitido." });
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json(401, { ok: false, error: "Sesión requerida." });
  const token = authorization.slice(7);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  const user = userData.user;
  if (userError || !user?.id || !user.email) return json(401, { ok: false, error: "La sesión no es válida." });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSON inválido." }); }

  if (body.action === "invite") {
    const organizationId = String(body.organization_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "viewer");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) return json(400, { ok: false, error: "Organización inválida." });
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, error: "Correo electrónico inválido." });
    if (!(["viewer", "inspector", "manager", "admin"] as string[]).includes(role)) return json(400, { ok: false, error: "Rol no permitido para invitación." });
    const { data: membership, error: membershipError } = await admin.from("members").select("role,active").eq("organization_id", organizationId).eq("user_id", user.id).eq("active", true).maybeSingle();
    if (membershipError) return json(500, { ok: false, error: "No se pudo validar la membresía." });
    if (!membership || !["owner", "admin"].includes(String(membership.role))) return json(403, { ok: false, error: "Solo owner o admin activo puede invitar integrantes." });
    if (membership.role !== "owner" && role === "admin") return json(403, { ok: false, error: "Solo owner puede invitar administradores." });
    if (email === user.email.toLowerCase()) return json(400, { ok: false, error: "No puedes invitar tu propio correo." });

    const { data: existingAuth } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = existingAuth?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (existing) {
      const { data: existingMember, error: emErr } = await admin.from("members").select("id,active").eq("organization_id", organizationId).eq("user_id", existing.id).maybeSingle();
      if (emErr) return json(500, { ok: false, error: "No se pudo verificar la membresía existente." });
      if (existingMember) return json(409, { ok: false, error: existingMember.active ? "Esta cuenta ya pertenece a la organización. Usa la gestión de miembros." : "Esta cuenta tiene una membresía inactiva; reactívala desde la gestión de miembros." });
      return json(409, { ok: false, error: "El correo ya tiene una cuenta Geotracia. Usa «Añadir cuenta ya registrada» para vincularla." });
    }

    const { data: subscription, error: subError } = await admin.from("geotracia_organization_subscriptions").select("status,current_period_end,operator_limit").eq("organization_id", organizationId).maybeSingle();
    if (subError) return json(500, { ok: false, error: "No se pudo comprobar la suscripción y sus límites." });
    if (!subscription || !["trialing", "active"].includes(String(subscription.status)) || (subscription.current_period_end && new Date(subscription.current_period_end).getTime() < Date.now())) return json(403, { ok: false, error: "La suscripción no permite incorporar integrantes en este momento." });
    const { count, error: countError } = await admin.from("members").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true);
    if (countError) return json(500, { ok: false, error: "No se pudo comprobar el cupo de usuarios." });
    if (subscription.operator_limit != null && (count ?? 0) >= Number(subscription.operator_limit)) return json(403, { ok: false, error: "La organización alcanzó el límite de usuarios de su plan." });

    const { data: invitation, error: insertError } = await admin.from("geotracia_organization_invitations").insert({ organization_id: organizationId, email, role, invited_by: user.id }).select("id,expires_at").single();
    if (insertError) return json(insertError.code === "23505" ? 409 : 500, { ok: false, error: insertError.code === "23505" ? "Ya existe una invitación pendiente para este correo." : "No se pudo registrar la invitación." });
    const siteUrl = (Deno.env.get("GEOTRACIA_SITE_URL") ?? "").trim();
    if (!siteUrl) {
      await admin.from("geotracia_organization_invitations").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", invitation.id);
      return json(500, { ok: false, error: "Falta configurar el secreto GEOTRACIA_SITE_URL con la URL pública de la aplicación." });
    }
    const redirectTo = `${siteUrl.replace(/\/$/, "")}/?geotracia_invite=1`;
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { geotracia_invitation_id: invitation.id } });
    if (inviteError) {
      await admin.from("geotracia_organization_invitations").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", invitation.id);
      return json(502, { ok: false, error: inviteError.message.includes("already been registered") ? "El correo ya está registrado. Usa «Añadir cuenta ya registrada»." : "Supabase Auth no pudo enviar el correo de invitación. Revisa la configuración SMTP y Auth." });
    }
    await admin.from("geotracia_organization_invitations").update({ auth_invite_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", invitation.id);
    return json(200, { ok: true, expires_at: invitation.expires_at });
  }

  if (body.action === "accept") {
    const email = user.email.toLowerCase();
    if (!user.email_confirmed_at) return json(403, { ok: false, error: "Confirma el correo antes de aceptar la invitación." });
    const invitationId = String(user.user_metadata?.geotracia_invitation_id ?? "");
    let query = admin.from("geotracia_organization_invitations").select("id,organization_id,email,role,expires_at,status,organizations(name)").eq("email", email).eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
    if (invitationId) query = query.eq("id", invitationId);
    const { data: rows, error: invError } = await query;
    if (invError) return json(500, { ok: false, error: "No se pudo consultar la invitación pendiente." });
    const invitation = rows?.[0];
    if (!invitation) return json(200, { ok: true, accepted: false });
    const { data: current, error: memberError } = await admin.from("members").select("id").eq("organization_id", invitation.organization_id).eq("user_id", user.id).maybeSingle();
    if (memberError) return json(500, { ok: false, error: "No se pudo verificar la membresía." });
    if (!current) {
      const { error: addError } = await admin.from("members").insert({ organization_id: invitation.organization_id, user_id: user.id, role: invitation.role, active: true });
      if (addError) return json(500, { ok: false, error: "No se pudo activar la membresía. Revisa el cupo del plan y la definición de members." });
    }
    await admin.from("geotracia_organization_invitations").update({ status: "accepted", accepted_by: user.id, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", invitation.id);
    const orgName = Array.isArray(invitation.organizations) ? invitation.organizations[0]?.name : (invitation.organizations as {name?: string}|null)?.name;
    return json(200, { ok: true, accepted: true, organization_id: invitation.organization_id, organization_name: orgName ?? "Geotracia", role: invitation.role });
  }
  return json(400, { ok: false, error: "Acción no reconocida." });
});
