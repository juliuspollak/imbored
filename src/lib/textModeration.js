// Deliberately narrow whole-word rules: ordinary game words such as kill, shoot,
// beat, assassin and score are allowed. Reports are never filtered as UGC.
export const MODERATION_MESSAGE = "Please edit this text. Abusive, threatening, sexually explicit or spam content is not allowed.";
export const MODERATION_PATTERNS = [
  String.raw`\b(fuck\w*|motherfuck\w*|cunt\w*|kurva|kokot\w*|nigg(er|a)s?|fagg?ots?|kikes?|chinks?)\b`,
  String.raw`\b(porn\w*|suck my (dick|cock)|send nudes|child porn\w*|sex with (a |an )?(child|children|minor|kids|underage)|rape you|raping you)\b`,
  String.raw`\b((i will|i'll|i'm going to|im going to|i am going to) (kill|murder|rape) (you|u)|kill yourself|go kill yourself|kys)\b`,
  String.raw`\b(buy now|free money|click here)\b[\s\S]*\b(buy now|free money|click here)\b`,
  String.raw`(https?://\S+\s*){5,}`,
  String.raw`(.)\1{29,}`,
];
export function moderationError(value) {
  const normalized = String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\u200b-\u200f\ufeff]/g, "").replace(/’/g, "'");
  return MODERATION_PATTERNS.some(pattern => new RegExp(pattern, "iu").test(normalized)) ? MODERATION_MESSAGE : null;
}
// Central submission boundary covers direct table writes and existing RPCs.
export const UGC_FIELDS = new Set([
  "body", "message", "name", "mood", "icon", "emoji", "title", "description", "admin_comment",
  "profile_name", "profile_mood", "profile_icon", "circle_name", "circle_emoji",
  "message_body", "reward_name", "reward_description", "reward_label", "reward_label_in",
  "challenge_title", "challenge_title_in", "player_name", "player_icon",
  "player_note", "admin_note", "note", "dispute_reason",
]);
export function payloadModerationError(payload) {
  if (Array.isArray(payload)) return payload.map(payloadModerationError).find(Boolean) || null;
  if (!payload || typeof payload !== "object") return null;
  for (const [key, value] of Object.entries(payload)) {
    if (UGC_FIELDS.has(key) && typeof value === "string" && moderationError(value)) return MODERATION_MESSAGE;
  }
  return null;
}
export function createModeratedFetch(fetcher) {
  return async (input, init) => {
    const url = String(input?.url || input);
    if (/\/rest\/v1\//.test(url) && /^(POST|PATCH|PUT)$/i.test(init?.method || "") && typeof init?.body === "string" && !/\/rpc\/(report_content|admin_)/.test(url)) {
      let payload;
      try { payload = JSON.parse(init.body); } catch { /* Non-JSON requests retain their usual handling. */ }
      const message = payloadModerationError(payload);
      if (message) return new Response(JSON.stringify({ message, code: "UGC_REJECTED" }), { status: 422, headers: { "Content-Type": "application/json" } });
    }
    return fetcher(input, init);
  };
}
