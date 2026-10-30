import "@langchain/macaw-components/styles.css";
import "./styles.css";

import { AppThemeProvider } from "@langchain/macaw-components/hooks/AppThemeProvider";
import { TooltipProvider } from "@langchain/macaw-components/Tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppThemeProvider defaultMode="system">
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </AppThemeProvider>
  </StrictMode>,
);
