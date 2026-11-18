import type { ReactNode } from "react";

// Owner: D. Page frame for D's pages: header + centred content. Colours and the top glow come from
// the one global theme in app/globals.css (no page-specific theme).

export function PageShell({
  title,
  description,
  width = "wide",
  children,
}: {
  title: string;
  description?: string;
  /** narrow = single-column screens (tracker, agent), wide = grids (Discover) */
  width?: "narrow" | "wide";
  children?: ReactNode;
}) {
  return (
    <section className="flex-1">
      <div className={`mx-auto w-full px-5 pt-8 pb-10 ${width === "narrow" ? "max-w-2xl" : "max-w-6xl"}`}>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}
