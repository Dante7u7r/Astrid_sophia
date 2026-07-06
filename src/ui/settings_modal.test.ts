// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsModal } from "./settings_modal";

function installSettingsDom(): void {
  document.body.innerHTML = `
    <div id="app-viewport"><button id="settings-trigger-btn">Ajustes</button></div>
    <div id="settings-modal" role="dialog" aria-hidden="true">
      <div id="settings-box">
        <input id="settings-dt-input" />
        <input id="settings-tol-input" />
        <input id="settings-iter-input" />
        <button id="btn-cancel-settings">Cancelar</button>
        <button id="btn-save-settings">Guardar</button>
      </div>
    </div>
  `;
}

describe("SettingsModal", () => {
  beforeEach(installSettingsDom);

  test("aísla la aplicación y devuelve el foco al cerrar con Escape", async () => {
    const trigger = document.querySelector("#settings-trigger-btn") as HTMLButtonElement;
    const modal = document.querySelector("#settings-modal") as HTMLElement;
    const app = document.querySelector("#app-viewport") as HTMLElement;
    new SettingsModal({ dt: 0.001, tolerance: 0.00001, maxIterations: 80 }, vi.fn());

    trigger.focus();
    trigger.click();
    await new Promise(requestAnimationFrame);
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.getAttribute("aria-hidden")).toBe("false");
    expect(app.inert).toBe(true);
    expect(document.activeElement?.id).toBe("settings-dt-input");

    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(requestAnimationFrame);
    expect(modal.classList.contains("open")).toBe(false);
    expect(app.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test("guarda una copia validada de los ajustes y cierra", () => {
    const onSave = vi.fn();
    const trigger = document.querySelector("#settings-trigger-btn") as HTMLButtonElement;
    const modal = document.querySelector("#settings-modal") as HTMLElement;
    new SettingsModal({ dt: 0.001, tolerance: 0.00001, maxIterations: 80 }, onSave);
    trigger.click();

    (document.querySelector("#settings-dt-input") as HTMLInputElement).value = "0.002";
    (document.querySelector("#settings-tol-input") as HTMLInputElement).value = "0.0001";
    (document.querySelector("#settings-iter-input") as HTMLInputElement).value = "120";
    (document.querySelector("#btn-save-settings") as HTMLButtonElement).click();

    expect(onSave).toHaveBeenCalledWith({ dt: 0.002, tolerance: 0.0001, maxIterations: 120 });
    expect(modal.getAttribute("aria-hidden")).toBe("true");
  });
});
