// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { DiagnosticModal } from "./diagnostic_modal";

describe("DiagnosticModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("renderiza modal con lista de problemas y badges", () => {
    const modal = DiagnosticModal.show({
      title: "Chequeo Eléctrico (ERC) Fallido",
      subtitle: "Se encontraron problemas:",
      issues: [
        {
          id: "1",
          severity: "error",
          title: "Sin Tierra (GND)",
          message: "El circuito no tiene referencia de potencial.",
          remedy: "Añade un símbolo de Tierra.",
          componentId: "V1",
        },
        {
          id: "2",
          severity: "warning",
          title: "Pin Flotante",
          message: "Terminal 2 de R1 está flotante.",
          componentId: "R1",
          pinIndex: 1,
        },
      ],
    });

    const backdrop = document.querySelector(".diagnostic-modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(document.querySelector(".badge-erc-error")?.textContent).toContain("1 Error");
    expect(document.querySelector(".badge-erc-warning")?.textContent).toContain("1 Advertencia");
    expect(document.querySelectorAll(".diagnostic-issue-card").length).toBe(2);

    modal.close();
    expect(document.querySelector(".diagnostic-modal-backdrop")).toBeNull();
  });

  test("ejecuta onFocusComponent al hacer clic en Localizar en Esquema", () => {
    const onFocus = vi.fn();
    DiagnosticModal.show({
      title: "Error Detectado",
      issues: [
        {
          id: "1",
          severity: "error",
          title: "Corto",
          message: "V1 cortocircuitada",
          componentId: "V1",
        },
      ],
      onFocusComponent: onFocus,
    });

    const focusBtn = document.querySelector(".btn-focus") as HTMLButtonElement;
    expect(focusBtn).not.toBeNull();
    focusBtn.click();

    expect(onFocus).toHaveBeenCalledWith("V1", undefined);
    expect(document.querySelector(".diagnostic-modal-backdrop")).toBeNull();
  });

  test("elimina el listener de Escape al cerrar", () => {
    const onDismiss = vi.fn();
    DiagnosticModal.show({
      title: "Error Detectado",
      issues: [
        {
          id: "1",
          severity: "error",
          title: "Corto",
          message: "V1 cortocircuitada",
        },
      ],
      onDismiss,
    });

    const closeButton = document.querySelector("#btn-diag-close") as HTMLButtonElement;
    closeButton.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("renderizar dos veces reemplaza el DOM y el listener anteriores", () => {
    const onDismiss = vi.fn();
    const modal = new DiagnosticModal({
      title: "Error Detectado",
      issues: [{ id: "1", severity: "error", title: "Corto", message: "V1 cortocircuitada" }],
      onDismiss,
    });

    modal.render();
    modal.render();
    expect(document.querySelectorAll(".diagnostic-modal-backdrop")).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
