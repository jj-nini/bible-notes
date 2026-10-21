import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./lib/toast";
import { TranslationsProvider } from "./lib/translations";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <TranslationsProvider>
        <App />
      </TranslationsProvider>
    </ToastProvider>
  </StrictMode>,
);
