import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Brand } from "../shared/components/Brand";
import "../styles/global.css";

function Foundation() {
  return (
    <main style={{ width: 380, padding: 24 }}>
      <Brand />
      <p style={{ color: "var(--text-secondary)", margin: "24px 0 0" }}>
        Eye breaks that wait for a natural pause.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Foundation />
  </StrictMode>,
);
