/**
 * Demo store contexts and hooks. Kept separate from the provider component so
 * hot module reloads never recreate the context objects the provider uses.
 */
import { createContext, useContext, type Dispatch } from "react";

import type { DemoAction, DemoState } from "./demo-state";

export const DemoStateContext = createContext<DemoState | null>(null);
export const DemoDispatchContext = createContext<Dispatch<DemoAction> | null>(null);

export function useDemoState(): DemoState {
  const value = useContext(DemoStateContext);
  if (!value) throw new Error("useDemoState must be used inside DemoStoreProvider");
  return value;
}

export function useDemoDispatch(): Dispatch<DemoAction> {
  const value = useContext(DemoDispatchContext);
  if (!value) throw new Error("useDemoDispatch must be used inside DemoStoreProvider");
  return value;
}
