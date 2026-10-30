import { MEMBERS, type BoardState, type MemberId, type MemberProfile } from "./types";

export type { MemberProfile, MemberProfiles } from "./types";
export const AVATAR_PRESETS = [
  "🙂", "😎", "🥳", "🤠", "🦊", "🐼", "🐱", "🐶", "🐸", "🐻", "🌻", "🚀",
  "🐰", "🐨", "🐯", "🦁", "🐷", "🐵", "🐹", "🦉", "🐧", "🦋", "🐝", "🐢",
  "🌵", "🍀", "🍄", "🌈", "⭐", "🌙", "🍒", "🍑", "🥑", "🍩", "☕", "✈️",
] as const;
export const MAX_AVATAR_BYTES = 24 * 1024;
export const MAX_AVATAR_DATA_URL_LENGTH = 4 * Math.ceil(MAX_AVATAR_BYTES / 3) + 23;
export const MAX_PROFILE_NAME_LENGTH = 24;
/** Both the previous and replacement avatar must fit in a field-baseline request. */
export const MAX_PROFILE_OPERATION_BYTES = 72 * 1024;

export function getMemberProfile(state: Pick<BoardState, "profiles">, memberId: MemberId): MemberProfile {
  return state.profiles?.[memberId] ?? { name: MEMBERS.find((member) => member.id === memberId)!.name, avatar: "" };
}

export function isValidProfileName(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() &&
    Array.from(value).length >= 1 && Array.from(value).length <= MAX_PROFILE_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}

/** Emoji choices plus legacy small raster data URLs; no SVG/URL/HTML. */
export function isValidAvatar(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "" || AVATAR_PRESETS.some((preset) => preset === value)) return true;
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value || match[2].length % 4 !== 0) return false;
  let bytes: string;
  try {
    bytes = atob(match[2]);
    if (btoa(bytes) !== match[2] || bytes.length > MAX_AVATAR_BYTES) return false;
  } catch { return false; }
  if (match[1] === "jpeg") return bytes.length >= 5 && bytes.startsWith("\xff\xd8\xff") && bytes.endsWith("\xff\xd9");
  if (match[1] === "png") return bytes.length >= 24 && bytes.startsWith("\x89PNG\r\n\x1a\n") && bytes.slice(12, 16) === "IHDR";
  return bytes.length >= 12 && bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
}
