import type { ReactNode } from "react";

// Owner: D. Page frame for D's pages: soft blue glow at the top, header, centered content.
// The glow uses `primary` (the accent), never the status tokens.

export function PageShell({
  title,
  description,
  width = "wide",
  children,
}: {
  title: string;
  description?: string;
  /** narrow = single-column screens (tracker, pass), wide = grids (Discover) */
  width?: "narrow" | "wide";
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate flex-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklch,var(--primary)_28%,transparent),transparent)]"
      />
      <div className={`mx-auto w-full px-4 py-8 ${width === "narrow" ? "max-w-2xl" : "max-w-6xl"}`}>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}
