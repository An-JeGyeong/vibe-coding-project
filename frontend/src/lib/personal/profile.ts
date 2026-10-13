import { readJson, removeKey, writeJson } from "./storage";

// A profile kept in this browser only (CONTRACTS 30.1 / D-063): a display name and a one-line introduction. It is not the sign-in
// account (name and role belong to the server) and it is never sent anywhere.
export const PROFILE_KEY = "mangabridge.profile.v1";
export const NAME_MAX = 20;
export const BIO_MAX = 100;
export type Profile = { displayName: string; bio: string };
export const EMPTY_PROFILE: Profile = { displayName: "", bio: "" };

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export type ProfileCheck = { ok: true; value: Profile } | { ok: false; message: string };

/** Trims both fields; the name may be empty (then none is shown), a too long or control-character value is refused. */
export function checkProfile(input: Profile): ProfileCheck {
  const displayName = input.displayName.trim(), bio = input.bio.trim();
  if (CONTROL.test(displayName) || CONTROL.test(bio)) return { ok: false, message: "사용할 수 없는 문자가 들어 있습니다." };
  if ([...displayName].length > NAME_MAX) return { ok: false, message: `표시 이름은 ${NAME_MAX}자 이하로 입력하세요.` };
  if ([...bio].length > BIO_MAX) return { ok: false, message: `소개는 ${BIO_MAX}자 이하로 입력하세요.` };
  return { ok: true, value: { displayName, bio } };
}

export function loadProfile(): Profile {
  const raw = readJson(PROFILE_KEY) as Partial<Profile> | null;
  if (!raw || typeof raw !== "object" || typeof raw.displayName !== "string" || typeof raw.bio !== "string") return EMPTY_PROFILE;
  const checked = checkProfile({ displayName: raw.displayName, bio: raw.bio });
  return checked.ok ? checked.value : EMPTY_PROFILE;
}

export function saveProfile(profile: Profile): ProfileCheck {
  const checked = checkProfile(profile);
  if (checked.ok) writeJson(PROFILE_KEY, checked.value);
  return checked;
}

export function clearProfile() { removeKey(PROFILE_KEY); }
