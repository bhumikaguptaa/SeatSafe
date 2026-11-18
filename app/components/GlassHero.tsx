import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Owner: D. Hero glass card, after Finora's credit card: a glass surface with soft, heavily blurred
// blue and white light blobs inside. Used for Discover's featured event, the order tracker's hero
// card and the gate pass ticket. Content sits above the blobs.

export function GlassHero({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={cn("glass relative isolate overflow-hidden rounded-3xl", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* Colours measured from Finora's card: light #acbce3, lavender-white #cec6df, mid #87a8e6 */}
        <div className="absolute inset-0 bg-white/[0.06]" />
        <div className="absolute -top-1/4 -left-1/5 size-[75%] rounded-full bg-[#acbce3]/70 blur-3xl" />
        <div className="absolute -right-1/5 top-[10%] size-[60%] rounded-full bg-[#cec6df]/55 blur-3xl" />
        <div className="absolute -bottom-1/3 left-1/4 size-[70%] rounded-full bg-[#87a8e6]/55 blur-3xl" />
      </div>
      {children}
    </Tag>
  );
}
