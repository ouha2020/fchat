/** Server-only invitation policy. An absent/empty list keeps new owner signup closed. */
export function isRegistrationAllowed(email: string): boolean {
  const approved = (process.env.FAMILY_REGISTRATION_ALLOWED_EMAILS ?? "")
    .split(/[\s,;]+/).filter(Boolean).map((value) => value.toLowerCase());
  return approved.includes(email.toLowerCase());
}
