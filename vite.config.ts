// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Pre-bundle libraries that are first imported deep in the app. Discovering them
    // mid-session triggers a dependency re-optimisation and reload, which can leave an
    // open tab with two React copies ("Cannot read properties of null (reading 'useMemo')").
    // The router-core/seroval entries are what the client-side server-function call
    // (useServerFn on the Assistant page) imports.
    optimizeDeps: {
      include: [
        "recharts",
        "xlsx",
        "zod",
        "sonner",
        "lucide-react",
        "@radix-ui/react-slot",
        "@radix-ui/react-label",
        "@radix-ui/react-collapsible",
        "@radix-ui/react-progress",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "seroval",
      ],
    },
  },
});
