// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsModal } from "./settings_modal";

function installSettingsDom(): void {
  document.body.innerHTML = `
    <div id="app-viewport"><button id="settings-trigger-btn">Ajustes</button></div>
    <div id="settings-modal" role="dialog" aria-hidden="true">
      <div id="settings-box">
        <input id="settings-dt-input" />
        <input id="settings-transient-duration-input" />
        <input id="settings-tol-input" />
        <input id="settings-iter-input" />
        <select id="settings-flow-mode-input">
          <option value="conventional">Convencional</option>
          <option value="electron">Electrónico</option>
        </select>
        <select id="settings-flow-speed-input">
          <option value="0.5">0.5</option>
          <option value="1.0">1.0</option>
          <option value="2.0">2.0</option>
        </select>
        <input type="checkbox" id="settings-show-current-anim" checked />
        <input type="checkbox" id="settings-show-thermal-heatmap" checked />
        <input type="checkbox" id="settings-show-reactive-fields" checked />
        <input type="checkbox" id="settings-show-telemetry-hud" checked />
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

  test("guarda una copia validada de los ajustes incluyendo capas visuales y cierra", () => {
    const onSave = vi.fn();
    const trigger = document.querySelector("#settings-trigger-btn") as HTMLButtonElement;
    const modal = document.querySelector("#settings-modal") as HTMLElement;
    new SettingsModal({ dt: 0.001, tolerance: 0.00001, maxIterations: 80 }, onSave);
    trigger.click();

    (document.querySelector("#settings-dt-input") as HTMLInputElement).value = "0.002";
    (document.querySelector("#settings-transient-duration-input") as HTMLInputElement).value = "8";
    (document.querySelector("#settings-tol-input") as HTMLInputElement).value = "0.0001";
    (document.querySelector("#settings-iter-input") as HTMLInputElement).value = "120";
    (document.querySelector("#settings-flow-mode-input") as HTMLSelectElement).value = "electron";
    (document.querySelector("#settings-flow-speed-input") as HTMLSelectElement).value = "2.0";
    (document.querySelector("#settings-show-current-anim") as HTMLInputElement).checked = true;
    (document.querySelector("#settings-show-thermal-heatmap") as HTMLInputElement).checked = false;
    (document.querySelector("#settings-show-reactive-fields") as HTMLInputElement).checked = false;
    (document.querySelector("#settings-show-telemetry-hud") as HTMLInputElement).checked = true;
    (document.querySelector("#btn-save-settings") as HTMLButtonElement).click();

    expect(onSave).toHaveBeenCalledWith({
      dt: 0.002,
      transientDuration: 8,
      tolerance: 0.0001,
      maxIterations: 120,
      currentFlowMode: "electron",
      currentAnimationSpeed: 2.0,
      showCurrentAnimation: true,
      showThermalHeatmap: false,
      showReactiveFields: false,
      showTelemetryHud: true,
    });
    expect(modal.getAttribute("aria-hidden")).toBe("true");
  });

  test("rechaza valores no físicos y mantiene abierto el diálogo", () => {
    const onSave = vi.fn();
    const trigger = document.querySelector("#settings-trigger-btn") as HTMLButtonElement;
    const modal = document.querySelector("#settings-modal") as HTMLElement;
    new SettingsModal({ dt: 0.001, tolerance: 0.00001, maxIterations: 80 }, onSave);
    trigger.click();

    (document.querySelector("#settings-dt-input") as HTMLInputElement).value = "-0.001";
    (document.querySelector("#settings-transient-duration-input") as HTMLInputElement).value = "0";
    (document.querySelector("#settings-tol-input") as HTMLInputElement).value = "NaN";
    (document.querySelector("#settings-iter-input") as HTMLInputElement).value = "0";
    (document.querySelector("#btn-save-settings") as HTMLButtonElement).click();

    expect(onSave).not.toHaveBeenCalled();
    expect(modal.classList.contains("open")).toBe(true);
  });
});
