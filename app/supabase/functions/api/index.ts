import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allowedOrigins = new Set([
  ...(Deno.env.get("WEB_ORIGIN") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://desenrola-facil-painel.onrender.com",
  "https://desenrola-facil-painel-72oq.onrender.com",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body, status = 200, origin = "") {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new Error("request_too_large");
  const value = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_object");
  return value;
}

function nonEmpty(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error("invalid_" + field);
  }
  return value.trim();
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("invalid_" + field);
  return value;
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("invalid_" + field);
  return new Date(value).toISOString();
}

function safeDbError(error, fallback) {
  if (!error) return null;
  return { error: fallback, code: error.code ?? "database_error" };
}

const listDefinitions = {
  "/v1/contacts": { table: "contacts", select: "id,full_name,email,phone,source,lifecycle_stage,interest_code,assigned_to,created_at,updated_at", order: "created_at" },
  "/v1/opportunities": { table: "opportunities", select: "id,contact_id,product_id,stage,expected_value,next_follow_up_at,owner_id,lost_reason,created_at,updated_at,contact:contacts(full_name),product:products(name)", order: "created_at" },
  "/v1/sales": { table: "sales", select: "id,contact_id,product_id,opportunity_id,status,amount,payment_method,installments,payment_confirmed_at,created_at,updated_at,contact:contacts(full_name),product:products(name)", order: "created_at" },
  "/v1/contracts": { table: "contracts", select: "id,contract_number,sale_id,status,contract_text,sent_at,signed_at,created_at,updated_at,created_by,sale:sales(amount,status,contact:contacts(full_name),product:products(name))", order: "created_at" },
  "/v1/finance": { table: "finance_entries", select: "id,sale_id,entry_type,status,description,amount,due_at,settled_at,payment_method,category,created_at,updated_at", order: "due_at" },
  "/v1/appointments": { table: "appointments", select: "id,contact_id,appointment_type,title,starts_at,ends_at,status,location,operational_notes,created_at,updated_at,contact:contacts(full_name)", order: "starts_at" },
  "/v1/mentorships": { table: "mentorship_enrollments", select: "id,sale_id,contact_id,product_id,status,started_at,ends_at,created_at,updated_at,contact:contacts(full_name),product:products(name)", order: "created_at" },
  "/v1/experiences": { table: "experiences", select: "id,code,name,description,location,starts_at,ends_at,status,price,capacity,created_at,updated_at", order: "starts_at" },
  "/v1/registrations": { table: "experience_registrations", select: "id,experience_id,contact_id,sale_id,status,created_at,updated_at,contact:contacts(full_name),experience:experiences(name)", order: "created_at" },
  "/v1/threads": { table: "conversation_threads", select: "id,contact_id,channel,provider_account_id,external_conversation_id,control_state,handoff_reason,assigned_to,last_message_at,created_at,updated_at", order: "last_message_at" },
  "/v1/conversations": { table: "conversation_events", select: "id,contact_id,thread_id,channel,direction,actor_type,body,delivery_status,safe_metadata,occurred_at,created_at,contact:contacts(full_name)", order: "occurred_at" },
};

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (request.method === "OPTIONS") return response({}, 204, origin);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return response({ error: "api_not_configured" }, 503, origin);
  if (request.method !== "GET" && request.method !== "POST") return response({ error: "method_not_allowed" }, 405, origin);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response({ error: "authentication_required" }, 401, origin);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return response({ error: "invalid_session" }, 401, origin);

  const url = new URL(request.url);
  const route = url.pathname.slice(url.pathname.lastIndexOf("/v1"));
  const parts = route.split("/").filter(Boolean);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  try {
    if (request.method === "GET" && route === "/v1/health") {
      const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", authData.user.id);
      if (error) return response(safeDbError(error, "access_check_failed"), 403, origin);
      return response({ status: "ok", roles: (roles ?? []).map((row) => row.role) }, 200, origin);
    }

    if (request.method === "GET" && route === "/v1/dashboard") {
      const { data, error } = await supabase.rpc("get_dashboard_summary");
      if (error) return response(safeDbError(error, "dashboard_unavailable"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "GET" && route === "/v1/products") {
      let query = supabase.from("products")
        .select("id,code,name,category,description,price,currency,delivery_mode,format,duration_text,duration_months,active")
        .order("name");
      if (url.searchParams.get("all") !== "1") query = query.eq("active", true);
      const { data, error } = await query;
      if (error) return response(safeDbError(error, "products_unavailable"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "GET" && route === "/v1/followups") {
      const { data, error } = await supabase.from("opportunities")
        .select("id,contact_id,product_id,stage,expected_value,next_follow_up_at,contact:contacts(full_name,phone),product:products(name)")
        .lte("next_follow_up_at", new Date().toISOString())
        .not("stage", "in", "(won,lost)")
        .order("next_follow_up_at", { ascending: true })
        .limit(limit);
      if (error) return response(safeDbError(error, "followups_unavailable"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && (route === "/v1/products" || (parts[1] === "products" && uuidPattern.test(parts[2] ?? "")))) {
      const input = await readJson(request);
      const categories = ["mentoria", "livro", "constelacao", "vivencia", "outro"];
      const modes = ["online", "presencial", "hibrido", "editorial"];
      const price = Number(input.price);
      if (!Number.isFinite(price) || price < 0 || price > 9999999999) return response({ error: "invalid_price" }, 422, origin);
      const durationMonths = input.duration_months === undefined || input.duration_months === null || input.duration_months === "" ? null : Number(input.duration_months);
      if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120)) return response({ error: "invalid_duration_months" }, 422, origin);
      if (input.active !== undefined && typeof input.active !== "boolean") return response({ error: "invalid_product_availability" }, 422, origin);
      if (!categories.includes(String(input.category)) || !modes.includes(String(input.delivery_mode))) return response({ error: "invalid_product_type" }, 422, origin);
      const product = {
        code: nonEmpty(input.code, "code", 80).toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        name: nonEmpty(input.name, "name", 160), category: input.category,
        description: typeof input.description === "string" ? input.description.slice(0, 2000) : "",
        price, currency: "BRL", delivery_mode: input.delivery_mode,
        format: typeof input.format === "string" ? input.format.slice(0, 160) : "",
        duration_text: typeof input.duration_text === "string" ? input.duration_text.slice(0, 120) : null,
        duration_months: durationMonths,
        active: input.active !== false,
      };
      const productId = parts[1] === "products" ? parts[2] : null;
      const result = productId
        ? await supabase.from("products").update(product).eq("id", productId).select().single()
        : await supabase.from("products").insert(product).select().single();
      const { data, error } = result;
      if (error) return response(safeDbError(error, "product_save_denied"), 403, origin);
      return response({ data }, productId ? 200 : 201, origin);
    }

    if (request.method === "GET" && listDefinitions[route]) {
      const definition = listDefinitions[route];
      let query = supabase.from(definition.table).select(definition.select).order(definition.order, { ascending: false }).limit(limit);
      const contactId = url.searchParams.get("contact_id");
      if (contactId && ["/v1/conversations", "/v1/opportunities", "/v1/sales", "/v1/appointments", "/v1/mentorships"].includes(route)) {
        if (!uuidPattern.test(contactId)) return response({ error: "invalid_contact_id" }, 422, origin);
        query = query.eq("contact_id", contactId);
      }
      const { data, error } = await query;
      if (error) return response(safeDbError(error, "records_unavailable"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/contacts") {
      const input = await readJson(request);
      const fullName = nonEmpty(input.full_name, "full_name", 160);
      const email = typeof input.email === "string" && input.email.trim() ? input.email.trim().toLowerCase() : null;
      const phone = typeof input.phone === "string" && input.phone.trim() ? input.phone.trim() : null;
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) return response({ error: "invalid_email" }, 422, origin);
      if (phone && phone.length > 40) return response({ error: "invalid_phone" }, 422, origin);
      const { data, error } = await supabase.from("contacts").insert({
        full_name: fullName, email, phone, source: "manual", lifecycle_stage: "lead",
      }).select("id,full_name,email,phone,source,lifecycle_stage,created_at").single();
      if (error) return response(safeDbError(error, "contact_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "contacts" && uuidPattern.test(parts[2] ?? "") && parts[3] === "stage") {
      const input = await readJson(request);
      const stages = ["lead", "qualified", "customer", "former_customer", "disqualified"];
      if (!stages.includes(String(input.lifecycle_stage))) return response({ error: "invalid_contact_stage" }, 422, origin);
      const { data, error } = await supabase.from("contacts").update({ lifecycle_stage: input.lifecycle_stage })
        .eq("id", parts[2]).select("id,lifecycle_stage").single();
      if (error) return response(safeDbError(error, "contact_stage_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/opportunities") {
      const input = await readJson(request);
      const contactId = optionalUuid(input.contact_id, "contact_id");
      const productId = optionalUuid(input.product_id, "product_id");
      if (!contactId) return response({ error: "invalid_contact_id" }, 422, origin);
      const { data, error } = await supabase.from("opportunities").insert({
        contact_id: contactId, product_id: productId, stage: "new",
        expected_value: typeof input.expected_value === "number" && input.expected_value >= 0 ? input.expected_value : null,
        next_follow_up_at: optionalTimestamp(input.next_follow_up_at, "next_follow_up_at"),
      }).select().single();
      if (error) return response(safeDbError(error, "opportunity_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "opportunities" && uuidPattern.test(parts[2] ?? "") && parts[3] === "stage") {
      const input = await readJson(request);
      const stages = ["new", "contacted", "qualified", "offer_presented", "negotiation", "won", "lost", "nurture"];
      if (!stages.includes(String(input.stage))) return response({ error: "invalid_stage" }, 422, origin);
      const update = {
        stage: input.stage,
        next_follow_up_at: optionalTimestamp(input.next_follow_up_at, "next_follow_up_at"),
        lost_reason: typeof input.lost_reason === "string" ? input.lost_reason.slice(0, 500) : null,
      };
      const { data, error } = await supabase.from("opportunities").update(update).eq("id", parts[2]).select().single();
      if (error) return response(safeDbError(error, "opportunity_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/sales") {
      const input = await readJson(request);
      const contactId = optionalUuid(input.contact_id, "contact_id");
      const productId = optionalUuid(input.product_id, "product_id");
      const opportunityId = optionalUuid(input.opportunity_id, "opportunity_id");
      if (!contactId || !productId) return response({ error: "contact_and_product_required" }, 422, origin);
      const paymentMethod = input.payment_method === "pix" || input.payment_method === "card" || input.payment_method === "other" ? input.payment_method : null;
      const installments = Number.isInteger(input.installments) ? Number(input.installments) : null;
      const { data, error } = await supabase.rpc("create_sale_with_receivable", {
        p_contact_id: contactId, p_product_id: productId, p_payment_method: paymentMethod,
        p_installments: installments, p_opportunity_id: opportunityId,
      });
      if (error) return response(safeDbError(error, "sale_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && route === "/v1/contracts") {
      const input = await readJson(request);
      const saleId = optionalUuid(input.sale_id, "sale_id");
      const contractText = nonEmpty(input.contract_text, "contract_text", 20_000);
      if (!saleId) return response({ error: "invalid_sale_id" }, 422, origin);
      const { data: sale, error: saleError } = await supabase.from("sales")
        .select("id,status").eq("id", saleId).maybeSingle();
      if (saleError) return response(safeDbError(saleError, "sale_unavailable"), 403, origin);
      if (!sale || !["pending", "confirmed"].includes(sale.status)) return response({ error: "sale_not_eligible_for_contract" }, 422, origin);
      const { data, error } = await supabase.from("contracts").insert({
        sale_id: saleId, contract_text: contractText, created_by: authData.user.id,
      }).select("id,contract_number,sale_id,status,contract_text,sent_at,signed_at,created_at,updated_at").single();
      if (error) return response(safeDbError(error, "contract_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "contracts" && uuidPattern.test(parts[2] ?? "") && parts.length === 3) {
      const input = await readJson(request);
      const contractText = nonEmpty(input.contract_text, "contract_text", 20_000);
      const { data, error } = await supabase.from("contracts").update({ contract_text: contractText })
        .eq("id", parts[2]).eq("status", "draft")
        .select("id,contract_number,sale_id,status,contract_text,sent_at,signed_at,created_at,updated_at").maybeSingle();
      if (error) return response(safeDbError(error, "contract_edit_denied"), 403, origin);
      if (!data) return response({ error: "draft_contract_not_found" }, 404, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "contracts" && uuidPattern.test(parts[2] ?? "") && parts[3] === "status") {
      const input = await readJson(request);
      const statuses = ["sent", "signed", "cancelled"];
      if (!statuses.includes(String(input.status))) return response({ error: "invalid_contract_status" }, 422, origin);
      const { data, error } = await supabase.from("contracts").update({ status: input.status })
        .eq("id", parts[2]).select("id,contract_number,status,sent_at,signed_at,updated_at").maybeSingle();
      if (error) return response(safeDbError(error, "contract_status_update_denied"), 403, origin);
      if (!data) return response({ error: "contract_not_found" }, 404, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "sales" && uuidPattern.test(parts[2] ?? "") && parts[3] === "confirm") {
      const input = await readJson(request);
      const reference = typeof input.payment_reference === "string" ? input.payment_reference.trim() : null;
      if (reference && reference.length > 200) return response({ error: "invalid_payment_reference" }, 422, origin);
      const { data, error } = await supabase.rpc("confirm_sale_receipt", {
        p_sale_id: parts[2], p_payment_reference: reference || null,
      });
      if (error) return response(safeDbError(error, "payment_confirmation_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/finance") {
      const input = await readJson(request);
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999) return response({ error: "invalid_amount" }, 422, origin);
      const entryType = input.entry_type === "income" || input.entry_type === "expense" ? input.entry_type : null;
      if (!entryType) return response({ error: "invalid_entry_type" }, 422, origin);
      const { data, error } = await supabase.from("finance_entries").insert({
        entry_type: entryType, status: "pending", description: nonEmpty(input.description, "description", 240),
        amount, due_at: typeof input.due_at === "string" ? input.due_at : null,
        payment_method: typeof input.payment_method === "string" ? input.payment_method : null,
        category: typeof input.category === "string" ? input.category.slice(0, 80) : "uncategorized",
        created_by: authData.user.id,
      }).select().single();
      if (error) return response(safeDbError(error, "finance_entry_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "finance" && uuidPattern.test(parts[2] ?? "") && parts[3] === "settle") {
      const { data, error } = await supabase.from("finance_entries").update({ status: "confirmed", settled_at: new Date().toISOString() })
        .eq("id", parts[2]).is("sale_id", null).select().single();
      if (error) return response(safeDbError(error, "settlement_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/appointments") {
      const input = await readJson(request);
      const startsAt = nonEmpty(input.starts_at, "starts_at", 40);
      const endsAt = nonEmpty(input.ends_at, "ends_at", 40);
      if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) return response({ error: "invalid_time_range" }, 422, origin);
      const contactId = optionalUuid(input.contact_id, "contact_id");
      const validTypes = ["mentoria", "constelacao", "vivencia", "reuniao", "outro"];
      const appointmentType = validTypes.includes(String(input.appointment_type)) ? input.appointment_type : "outro";
      const { data, error } = await supabase.from("appointments").insert({
        contact_id: contactId, appointment_type: appointmentType, title: nonEmpty(input.title, "title", 200),
        starts_at: startsAt, ends_at: endsAt, location: typeof input.location === "string" ? input.location.slice(0, 200) : "",
        operational_notes: typeof input.operational_notes === "string" ? input.operational_notes.slice(0, 2000) : "",
        created_by: authData.user.id,
      }).select().single();
      if (error) return response(safeDbError(error, "appointment_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "appointments" && uuidPattern.test(parts[2] ?? "") && parts[3] === "cancel") {
      const { data, error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", parts[2]).select().single();
      if (error) return response(safeDbError(error, "appointment_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "mentorships" && uuidPattern.test(parts[2] ?? "") && parts[3] === "status") {
      const input = await readJson(request);
      const statuses = ["active", "completed", "cancelled"];
      if (!statuses.includes(String(input.status))) return response({ error: "invalid_mentorship_status" }, 422, origin);
      const { data, error } = await supabase.from("mentorship_enrollments").update({ status: input.status })
        .eq("id", parts[2]).select().single();
      if (error) return response(safeDbError(error, "mentorship_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/experiences") {
      const input = await readJson(request);
      const statuses = ["draft", "planned", "completed", "cancelled"];
      const price = input.price === null || input.price === undefined ? null : Number(input.price);
      if (price !== null && (!Number.isFinite(price) || price < 0)) return response({ error: "invalid_price" }, 422, origin);
      const { data, error } = await supabase.from("experiences").insert({
        code: nonEmpty(input.code, "code", 80).toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        name: nonEmpty(input.name, "name", 200), description: typeof input.description === "string" ? input.description.slice(0, 2000) : "",
        location: typeof input.location === "string" ? input.location.slice(0, 200) : "",
        starts_at: typeof input.starts_at === "string" ? input.starts_at : null,
        ends_at: typeof input.ends_at === "string" ? input.ends_at : null,
        status: statuses.includes(String(input.status)) ? input.status : "draft",
        price, capacity: Number.isInteger(input.capacity) && Number(input.capacity) >= 0 ? input.capacity : null,
      }).select().single();
      if (error) return response(safeDbError(error, "experience_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "experiences" && uuidPattern.test(parts[2] ?? "") && parts[3] === "status") {
      const input = await readJson(request);
      const statuses = ["draft", "planned", "completed", "cancelled"];
      if (!statuses.includes(String(input.status))) return response({ error: "invalid_experience_status" }, 422, origin);
      const { data, error } = await supabase.from("experiences").update({ status: input.status })
        .eq("id", parts[2]).select("id,status").single();
      if (error) return response(safeDbError(error, "experience_status_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && route === "/v1/registrations") {
      const input = await readJson(request);
      const experienceId = optionalUuid(input.experience_id, "experience_id");
      const contactId = optionalUuid(input.contact_id, "contact_id");
      const saleId = optionalUuid(input.sale_id, "sale_id");
      if (!experienceId || !contactId) return response({ error: "experience_and_contact_required" }, 422, origin);
      const { data, error } = await supabase.rpc("register_experience_participant", {
        p_experience_id: experienceId, p_contact_id: contactId, p_sale_id: saleId,
      });
      if (error) return response(safeDbError(error, "registration_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    if (request.method === "POST" && parts[1] === "registrations" && uuidPattern.test(parts[2] ?? "") && parts[3] === "status") {
      const input = await readJson(request);
      if (!['attended','cancelled'].includes(String(input.status))) return response({ error: "invalid_registration_status" }, 422, origin);
      const { data, error } = await supabase.from("experience_registrations").update({ status: input.status })
        .eq("id", parts[2]).select("id,status").single();
      if (error) return response(safeDbError(error, "registration_status_update_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "threads" && uuidPattern.test(parts[2] ?? "") && parts[3] === "handoff") {
      const input = await readJson(request);
      const { data, error } = await supabase.from("conversation_threads").update({
        control_state: "human_requested", handoff_reason: typeof input.reason === "string" ? input.reason.slice(0, 240) : "Atendimento humano solicitado",
      }).eq("id", parts[2]).select().single();
      if (error) return response(safeDbError(error, "handoff_failed"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "threads" && uuidPattern.test(parts[2] ?? "") && parts[3] === "resume") {
      const { data, error } = await supabase.from("conversation_threads").update({ control_state: "automation", handoff_reason: null })
        .eq("id", parts[2]).select().single();
      if (error) return response(safeDbError(error, "automation_resume_denied"), 403, origin);
      return response({ data }, 200, origin);
    }

    if (request.method === "POST" && parts[1] === "contacts" && uuidPattern.test(parts[2] ?? "") && parts[3] === "conversations") {
      const input = await readJson(request);
      const { data, error } = await supabase.from("conversation_events").insert({
        contact_id: parts[2], channel: "internal", direction: "internal", actor_type: "human",
        body: nonEmpty(input.body, "body", 4000), created_by: authData.user.id,
      }).select("id,contact_id,channel,direction,actor_type,body,occurred_at,created_at").single();
      if (error) return response(safeDbError(error, "conversation_note_not_created"), 403, origin);
      return response({ data }, 201, origin);
    }

    return response({ error: "not_found" }, 404, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_request";
    const allowedValidation = /^(invalid_|request_too_large|invalid_json_object|contact_and_product_required)/.test(message);
    return response({ error: allowedValidation ? message : "invalid_request" }, allowedValidation ? 422 : 400, origin);
  }
});
