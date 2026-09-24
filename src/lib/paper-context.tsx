import type { ReactNode } from "react";
import { paperContext } from "@/lib/paper-context-state";
import type { PaperIdentity } from "@/lib/paper-identity";

export function PaperProvider({ children, value }: { children: ReactNode; value: PaperIdentity }) {
  return <paperContext.Provider value={value}>{children}</paperContext.Provider>;
}
