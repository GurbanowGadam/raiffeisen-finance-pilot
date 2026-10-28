import { createServerFn } from "@tanstack/react-start";

import { validateAgentRequest, type AgentRequestInput } from "./agent-contract";
import { executeAgentRun } from "./agent.server";

/**
 * Runs one assistant request (live Lovable AI or guided demo) on the caller's
 * isolated session snapshot. Public endpoint by design (no accounts in this demo):
 * it only reads the snapshot it is given and returns hypothetical changes.
 */
export const runAssistant = createServerFn({ method: "POST" })
  .inputValidator((raw: AgentRequestInput) => validateAgentRequest(raw))
  .handler(async ({ data }) => executeAgentRun(data));
