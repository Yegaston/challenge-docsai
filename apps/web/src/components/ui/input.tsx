import * as React from "react";
import { cn } from "@/lib/utils";
function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn("w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)} {...props} />;
}
export { Input };
