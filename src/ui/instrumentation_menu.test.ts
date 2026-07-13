// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initInstrumentationMenu, parseErcIssues } from "./instrumentation_menu";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("parseErcIssues", () => {
  it("normaliza advertencias con terminal y errores con varios componentes", () => {
    const issues = parseErcIssues(
      ["[R1] terminal index 1 queda flotante"],
      ["Corto entre fuentes [V1, V2]"],
    );

    expect(issues).toEqual([
      {
        componentId: "R1",
        type: "warning",
        message: "[R1] terminal index 1 queda flotante",
        pinIndex: 1,
      },
      { componentId: "V1", type: "error", message: "Corto entre fuentes [V1, V2]" },
      { componentId: "V2", type: "error", message: "Corto entre fuentes [V1, V2]" },
    ]);
  });
});

describe("initInstrumentationMenu", () => {
  it("conecta acciones principales y registra el resultado ERC", () => {
    document.body.innerHTML = `
      <button id="instruments-menu-btn"></button>
      <div id="instruments-dropdown">
        <button class="dropdown-menu-item-btn" id="menu-toggle-left"></button>
        <button class="dropdown-menu-item-btn" id="menu-toggle-right"></button>
        <button class="dropdown-menu-item-btn" id="menu-toggle-dock"></button>
        <button class="dropdown-menu-item-btn" id="menu-run-erc"></button>
        <button class="dropdown-menu-item-btn" id="menu-settings"></button>
      </div>
    `;
    const actions = {
      toggleLeftPanel: vi.fn(),
      toggleRightPanel: vi.fn(),
      toggleInstrumentCenter: vi.fn(),
      runErc: vi.fn(() => ({
        passed: false,
        warnings: [],
        errors: ["Falta GND [R1]"],
        issues: [{ componentId: "R1", type: "error" as const, message: "Falta GND [R1]" }],
      })),
      openSettings: vi.fn(),
      addLog: vi.fn(),
    };

    const menu = initInstrumentationMenu(actions);
    expect(menu).not.toBeNull();

    document.querySelector<HTMLButtonElement>("#menu-toggle-left")!.click();
    document.querySelector<HTMLButtonElement>("#menu-toggle-right")!.click();
    document.querySelector<HTMLButtonElement>("#menu-toggle-dock")!.click();
    document.querySelector<HTMLButtonElement>("#menu-run-erc")!.click();
    document.querySelector<HTMLButtonElement>("#menu-settings")!.click();

    expect(actions.toggleLeftPanel).toHaveBeenCalledOnce();
    expect(actions.toggleRightPanel).toHaveBeenCalledOnce();
    expect(actions.toggleInstrumentCenter).toHaveBeenCalledOnce();
    expect(actions.runErc).toHaveBeenCalledOnce();
    expect(actions.addLog).toHaveBeenCalledWith(
      "ERC falló con 1 errores críticos. Chequee los halos pulsantes en el lienzo.",
      "error",
    );
    expect(actions.openSettings).toHaveBeenCalledOnce();
  });
});
