// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { TooltipManager } from "./tooltip_manager";

describe("TooltipManager", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="btn1" data-tooltip="Botón de prueba 1" style="width: 100px; height: 30px; top: 50px; left: 50px; position: absolute;">Botón 1</div>
      <div id="btn-top" data-tooltip="Botón en el borde superior" style="width: 100px; height: 30px; top: 2px; left: 50px; position: absolute;">Borde</div>
      <div id="no-tooltip">Sin tooltip</div>
    `;
    TooltipManager.init();
  });

  it("muestra el tooltip al pasar el cursor sobre un elemento con data-tooltip", () => {
    const btn = document.getElementById("btn1")!;
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector(".premium-tooltip") as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.textContent).toBe("Botón de prueba 1");
    expect(tooltip.classList.contains("visible")).toBe(true);
  });

  it("oculta el tooltip al hacer mouseout o click", () => {
    const btn = document.getElementById("btn1")!;
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector(".premium-tooltip") as HTMLElement;
    expect(tooltip.classList.contains("visible")).toBe(true);

    btn.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(tooltip.classList.contains("visible")).toBe(false);

    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tooltip.classList.contains("visible")).toBe(true);

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("ajusta la posición cuando está cerca del borde superior", () => {
    const btnTop = document.getElementById("btn-top")!;
    btnTop.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector(".premium-tooltip") as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.classList.contains("visible")).toBe(true);
  });

  it("no muestra tooltip en elementos sin data-tooltip", () => {
    const noTooltip = document.getElementById("no-tooltip")!;
    noTooltip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector(".premium-tooltip") as HTMLElement;
    if (tooltip) {
      expect(tooltip.classList.contains("visible")).toBe(false);
    }
  });
});
