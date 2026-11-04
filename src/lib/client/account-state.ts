/*
 * Client-side state cleanup for DRESSED.
 *
 * Supabase Auth stays the only source of truth for authentication — this module
 * never stores or reads credentials. It only removes user-specific caches that
 * are NOT namespaced per user, so nothing from one account can be shown to the
 * next account signed in on the same browser:
 *
 *   closet-items            legacy local wardrobe fallback   (localStorage)
 *   closet-source-photo     base64 source photo fallback     (localStorage)
 *   dressed-character       character cache (path + image)   (localStorage)
 *   dressed-profile-outfit: *  chosen outfit id per user      (localStorage)
 *   dressed-generation-flow generation status                (sessionStorage)
 *
 * Called after a successful LOG OUT and after a successful ACCOUNT DELETION.
 * Keys are removed, never rewritten — legacy fallback behaviour itself is
 * untouched and keeps working for the signed-in user.
 */

const LOCAL_STORAGE_KEYS = [
  "closet-items",
  "closet-source-photo",
  "dressed-character",
] as const;

const LOCAL_STORAGE_PREFIXES = ["dressed-profile-outfit:"] as const;

const SESSION_STORAGE_KEYS = ["dressed-generation-flow"] as const;

export function clearDressedClientState(): void {
  try {
    for (const key of LOCAL_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    for (const prefix of LOCAL_STORAGE_PREFIXES) {
      const matching: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith(prefix)) matching.push(key);
      }
      for (const key of matching) window.localStorage.removeItem(key);
    }
    for (const key of SESSION_STORAGE_KEYS) {
      window.sessionStorage.removeItem(key);
    }
  } catch (error) {
    // Storage can be unavailable (private mode/quota). Cleanup must never break
    // logout or account deletion — Supabase Auth has already been invalidated.
    console.warn("Could not clear local DRESSED state.", error);
  }
}
