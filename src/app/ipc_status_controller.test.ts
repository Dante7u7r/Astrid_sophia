// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createIpcStatusController } from "./ipc_status_controller";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("IpcStatusController", () => {
  it("actualiza el indicador IPC si existe en el DOM", () => {
    document.body.innerHTML = `
      <span id="ipc-status-dot"></span>
      <span id="ipc-status-text"></span>
    `;
    const controller = createIpcStatusController();

    controller.init();
    controller.setStatus("Rust activo", "#00ff88");

    expect(document.querySelector("#ipc-status-dot")?.classList.contains("active")).toBe(true);
    expect(document.querySelector<HTMLElement>("#ipc-status-text")?.textContent).toBe("Rust activo");
    expect(document.querySelector<HTMLElement>("#ipc-status-text")?.style.color).toBe("#00ff88");
  });

  it("renderiza el badge FALLBACK: SOLO LINEAL y actualiza el footer cuando el status es fallback", () => {
    document.body.innerHTML = `
      <span id="ipc-status-dot"></span>
      <span id="ipc-status-text"></span>
      <div class="footer-solver">Solver: MNA Newton-Raphson (Rust)</div>
    `;
    const controller = createIpcStatusController();

    controller.init();
    controller.setStatus("FALLBACK: SOLO LINEAL", "var(--warning)");

    const textEl = document.querySelector<HTMLElement>("#ipc-status-text");
    const footerEl = document.querySelector<HTMLElement>(".footer-solver");

    expect(textEl?.innerHTML).toContain("badge-fallback-linear");
    expect(textEl?.textContent).toBe("FALLBACK: SOLO LINEAL");
    expect(footerEl?.textContent).toContain("Solo Lineal");
  });
});
