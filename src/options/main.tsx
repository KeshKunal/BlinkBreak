import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Brand } from "../shared/components/Brand";
import "../styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 40 }}>
      <Brand />
    </main>
  </StrictMode>,
);
