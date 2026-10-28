import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it.each([
    ["/", "/"],
    ["/transactions", "/transactions"],
    ["/calendar", "/calendar"],
    ["/agent", "/agent"],
    ["/solutions", "/solutions"], ["/upload", "/upload"], ["/bank", "/bank"],
  ])("matches the %s page", (path, routeId) => {
    const matches = router.matchRoutes(path);
    const leaf = matches.at(-1)?.routeId;
    expect(leaf).not.toBe(rootRouteId);
    expect(leaf).toBe(routeId);
  });
});
