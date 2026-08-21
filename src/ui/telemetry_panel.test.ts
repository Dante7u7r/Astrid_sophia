// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TelemetryPanel } from "./telemetry_panel";

describe("TelemetryPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="telemetry-ram-text">--</div>
      <div id="telemetry-cpu-text">--</div>
      <div id="telemetry-fps-text">--</div>
      <div id="toast-container"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renderiza un toast con icono y mensaje", () => {
    TelemetryPanel.showToast("Operación completada exitosamente", "success", "Listo");

    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();

    const toast = container?.querySelector(".toast-card.toast-success");
    expect(toast).not.toBeNull();

    const title = toast?.querySelector(".toast-title");
    expect(title?.textContent).toBe("Listo");

    const message = toast?.querySelector(".toast-message");
    expect(message?.textContent).toBe("Operación completada exitosamente");
  });

  it("renderiza botones de acción interactivos en el toast", () => {
    const onActionClick = vi.fn();
    TelemetryPanel.showToast("Alerta de simulación", "warning", {
      title: "Aviso",
      actions: [
        { label: "Detener", primary: true, onClick: onActionClick },
      ],
    });

    const actionBtn = document.querySelector<HTMLButtonElement>(".btn-toast-action");
    expect(actionBtn).not.toBeNull();
    expect(actionBtn?.textContent).toBe("Detener");

    actionBtn?.click();
    expect(onActionClick).toHaveBeenCalledOnce();
  });

  it("registra errores globales con logError y crea un toast de error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    TelemetryPanel.logError("Matriz MNA singular detectada");

    expect(TelemetryPanel.lastError).toBe("Matriz MNA singular detectada");
    expect(errorSpy).toHaveBeenCalled();

    const errorToast = document.querySelector(".toast-card.toast-error");
    expect(errorToast).not.toBeNull();
    expect(errorToast?.textContent).toContain("Matriz MNA singular detectada");
  });

  it("inicia y detiene el monitoreo local de rendimiento", () => {
    const mockSnapshot = {
      fpsEstimate: 59.8,
      canvasFrames: 120,
      oscilloscopeFrames: 60,
      skippedDmmUpdates: 0,
      recentFrameDurationsMs: [16.6],
    };
    const panel = new TelemetryPanel(() => mockSnapshot);
    panel.start();

    const fpsEl = document.querySelector("#telemetry-fps-text");
    expect(fpsEl?.textContent).toBe("60 FPS");

    panel.stop();
  });
});
