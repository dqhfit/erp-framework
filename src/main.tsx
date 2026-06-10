import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporter } from "@/lib/error-reporter";
import { routeTree } from "./routeTree.gen";
import "@/core/llm"; // Register all LLM adapters
import "@/plugins"; // Plugin loader — tự nạp mọi plugin trong src/plugins/
import "./styles/index.css";

// Bắt lỗi runtime (uncaught + promise) → gửi về server cho admin theo dõi.
installGlobalErrorReporter();

const router = createRouter({ routeTree });
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Thiếu element #root trong index.html");
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
