export const FIRST_OWNER_EMAIL = "desenrolafaciljud@gmail.com";

export function normalizeOwnerProfile(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "invalid_full_name" };
  const fullName = typeof input.full_name === "string" ? input.full_name.trim() : "";
  if (fullName.length < 1 || fullName.length > 160) return { error: "invalid_full_name" };
  return { full_name: fullName };
}

export function isFirstOwnerIdentityAllowed(user) {
  return Boolean(
    user?.id &&
    user.email_confirmed_at &&
    typeof user.email === "string" &&
    user.email.trim().toLowerCase() === FIRST_OWNER_EMAIL
  );
}
