export const TERMS_VERSION = "2026-09-16";
export const TERMS_URL = "https://imbored.au/terms";
export const PRIVACY_URL = "https://imbored.au/privacy";
export function hasCurrentTerms(record) {
  return record?.terms_version === TERMS_VERSION && !!record?.terms_accepted_at;
}

export async function acceptCurrentTerms(client) {
  const { error } = await client.rpc("accept_current_terms", { accepted_version: TERMS_VERSION });
  if (error) throw error;
}

export async function loadCurrentTerms(client, userId, agreed = false) {
  const { data, error } = await client.from("account_terms_acceptances")
    .select("terms_version,terms_accepted_at").eq("user_id", userId)
    .eq("terms_version", TERMS_VERSION).maybeSingle();
  if (error) throw error;
  if (hasCurrentTerms(data)) return true;
  if (!agreed) return false;
  await acceptCurrentTerms(client);
  return true;
}
