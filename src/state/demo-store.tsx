import { useEffect, useReducer, type ReactNode } from "react";

import { DemoDispatchContext, DemoStateContext } from "./demo-context";
import { createInitialDemoState, demoReducer, isCurrentDemoState } from "./demo-state";

/** In-memory demo session. Nothing is persisted; a page reload also restores the baseline. */
export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(demoReducer, undefined, createInitialDemoState);
  const current = isCurrentDemoState(state);

  // Hot reload can keep state created by an older version of the code. Replace it
  // with a fresh baseline instead of letting pages read fields that do not exist.
  useEffect(() => {
    if (!current) dispatch({ type: "reset" });
  }, [current]);

  if (!current) return null;
  return (
    <DemoStateContext.Provider value={state}>
      <DemoDispatchContext.Provider value={dispatch}>{children}</DemoDispatchContext.Provider>
    </DemoStateContext.Provider>
  );
}
