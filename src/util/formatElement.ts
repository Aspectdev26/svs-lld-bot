import type { Element } from "../types.js";

export const ELEMENT_EMOJI: Record<Element, string> = {
  Cold: "❄️",
  Light: "⚡",
  Fire: "🔥",
};

/** Prefixes an element name with its emoji (❄️ Cold / ⚡ Light / 🔥 Fire) for any player-facing text. */
export function formatElement(element: Element): string {
  return `${ELEMENT_EMOJI[element]} ${element}`;
}
