// Owner: D. Tiny event bus for the logo swivel: pages and purchase toasts call swivelLogo(), the nav logo
// (components/BrandMark.tsx with `swivel`) listens and spins once. No state, no context.

export const SWIVEL_EVENT = "seatsafe:swivel";

export function swivelLogo() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SWIVEL_EVENT));
}
