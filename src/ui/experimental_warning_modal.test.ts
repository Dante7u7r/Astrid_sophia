// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentalWarningModal } from "./experimental_warning_modal";

describe("ExperimentalWarningModal", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="modal-overlay" id="experimental-warning-modal">
        <h3 id="exp-warning-title"></h3>
        <p id="exp-warning-message"></p>
        <button id="btn-exp-confirm"></button>
        <button id="btn-exp-cancel"></button>
      </div>
    `;
  });

  it("abre el modal con el nombre de la función experimental y llama a onConfirm", () => {
    const modal = new ExperimentalWarningModal();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    modal.open({
      featureName: "Análisis PSS",
      onConfirm,
      onCancel,
    });

    const modalEl = document.querySelector("#experimental-warning-modal") as HTMLElement;
    const msgEl = document.querySelector("#exp-warning-message") as HTMLElement;
    const confirmBtn = document.querySelector("#btn-exp-confirm") as HTMLButtonElement;

    expect(modalEl.classList.contains("open")).toBe(true);
    expect(msgEl.innerHTML).toContain("Análisis PSS");

    confirmBtn.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(modalEl.classList.contains("open")).toBe(false);
  });

  it("cierra el modal y llama a onCancel al presionar Cancelar o Escape", () => {
    const modal = new ExperimentalWarningModal();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    modal.open({
      featureName: "Polos y Ceros (STB)",
      onConfirm,
      onCancel,
    });

    const cancelBtn = document.querySelector("#btn-exp-cancel") as HTMLButtonElement;
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    modal.open({
      featureName: "BSIM3",
      onConfirm,
      onCancel,
    });

    const modalEl = document.querySelector("#experimental-warning-modal") as HTMLElement;
    modalEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
