import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";
import "./shell.css";
import { AuthProvider } from "./auth";
import App from "./App";
import { trackKeyboardViewport } from "./telegram";
trackKeyboardViewport();
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, error) =>
        !(
          "status" in error && [401, 403, 404].includes(error.status as number)
        ) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
