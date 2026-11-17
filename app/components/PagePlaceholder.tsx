import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** Placeholder header for pages that haven't been built yet. Shows who owns the file. */
export function PagePlaceholder({
  title,
  description,
  owner,
  children,
}: {
  title: string;
  description: string;
  owner: "A" | "B" | "D";
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <Badge variant="outline">Owner: {owner}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}
