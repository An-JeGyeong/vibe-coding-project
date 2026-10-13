import { PERSONAL_EVENT } from "./storage";

// Screen theme (CONTRACTS 30.1, 30.3): light unless the reader chose dark; the system setting is not followed.
export const THEME_KEY = "mangabridge.theme.v1";
export type Theme = "light" | "dark";

/** Runs before the first paint (inline script in the root layout) so a dark choice never flashes white. */
export const THEME_BOOT_SCRIPT = `try{if(window.localStorage.getItem(${JSON.stringify(THEME_KEY)})==='"dark"')document.documentElement.setAttribute('data-bs-theme','dark')}catch(e){}`;

export function loadTheme(): Theme {
  try { return JSON.parse(window.localStorage.getItem(THEME_KEY) ?? "null") === "dark" ? "dark" : "light"; } catch { return "light"; }
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
}

export function saveTheme(theme: Theme) {
  applyTheme(theme);
  try { window.localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { /* storage unavailable: the choice lasts until the page closes */ }
  try { window.dispatchEvent(new Event(PERSONAL_EVENT)); } catch { /* no window */ }
}
