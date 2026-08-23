// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConfirmationModal } from "./confirmation_modal";

describe("ConfirmationModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    ConfirmationModal.closeCurrent();
  });

  it("renderiza el modal con el título y mensaje indicados", async () => {
    const promise = ConfirmationModal.confirm({
      title: "Cerrar circuito",
      message: "¿Deseas descartar los cambios?",
      confirmText: "Descartar",
      cancelText: "Volver",
      danger: true,
    });

    const backdrop = document.querySelector(".confirmation-modal-backdrop");
    expect(backdrop).not.toBeNull();

    const titleEl = backdrop?.querySelector(".confirmation-title");
    expect(titleEl?.textContent).toBe("Cerrar circuito");

    const messageEl = backdrop?.querySelector(".confirmation-body");
    expect(messageEl?.textContent).toContain("¿Deseas descartar los cambios?");

    const btnConfirm = backdrop?.querySelector("#btn-modal-confirm") as HTMLButtonElement;
    expect(btnConfirm?.textContent).toBe("Descartar");
    expect(btnConfirm?.classList.contains("btn-confirm-danger")).toBe(true);

    btnConfirm.click();
    const result = await promise;
    expect(result).toBe(true);
    expect(document.querySelector(".confirmation-modal-backdrop")).toBeNull();
  });

  it("resuelve false al hacer clic en cancelar", async () => {
    const promise = ConfirmationModal.confirm({
      message: "¿Continuar?",
    });

    const btnCancel = document.querySelector("#btn-modal-cancel") as HTMLButtonElement;
    btnCancel.click();

    const result = await promise;
    expect(result).toBe(false);
    expect(document.querySelector(".confirmation-modal-backdrop")).toBeNull();
  });

  it("resuelve false al presionar Escape", async () => {
    const promise = ConfirmationModal.confirm({
      message: "¿Continuar?",
    });

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);

    const result = await promise;
    expect(result).toBe(false);
    expect(document.querySelector(".confirmation-modal-backdrop")).toBeNull();
  });
});
