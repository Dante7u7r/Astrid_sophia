// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { initComponentPaletteController } from "./component_palette_controller";

afterEach(() => {
  document.body.innerHTML = "";
});

function setupDom(): void {
  document.body.innerHTML = `
    <input id="component-search" />
    <section class="category-group" id="pasivos">
      <button class="category-header active" data-category="pasivos">Pasivos</button>
      <div class="category-content open">
        <button class="component-card"><span class="comp-name">Resistor</span><span class="comp-desc">Resistencia</span></button>
        <button class="component-card"><span class="comp-name">Capacitor</span><span class="comp-desc">Condensador</span></button>
      </div>
    </section>
    <section class="category-group" id="fuentes">
      <button class="category-header" data-category="fuentes">Fuentes</button>
      <div class="category-content">
        <button class="component-card"><span class="comp-name">Fuente DC</span><span class="comp-desc">Tension continua</span></button>
      </div>
    </section>
  `;
}

describe("ComponentPaletteController", () => {
  it("alterna una categoria al pulsar su encabezado", () => {
    setupDom();
    initComponentPaletteController();

    const header = document.querySelector<HTMLElement>("#fuentes .category-header")!;
    const content = document.querySelector<HTMLElement>("#fuentes .category-content")!;

    header.click();

    expect(header.classList.contains("active")).toBe(true);
    expect(content.classList.contains("open")).toBe(true);

    header.click();

    expect(header.classList.contains("active")).toBe(false);
    expect(content.classList.contains("open")).toBe(false);
  });

  it("filtra tarjetas por busqueda y restaura el estado por defecto al limpiar", () => {
    setupDom();
    initComponentPaletteController();

    const search = document.querySelector<HTMLInputElement>("#component-search")!;
    const pasivos = document.querySelector<HTMLElement>("#pasivos")!;
    const fuentes = document.querySelector<HTMLElement>("#fuentes")!;
    const fuentesHeader = document.querySelector<HTMLElement>("#fuentes .category-header")!;
    const fuentesContent = document.querySelector<HTMLElement>("#fuentes .category-content")!;

    search.value = "dc";
    search.dispatchEvent(new Event("input"));

    expect(pasivos.style.display).toBe("none");
    expect(fuentes.style.display).toBe("block");
    expect(fuentesHeader.classList.contains("active")).toBe(true);
    expect(fuentesContent.classList.contains("open")).toBe(true);

    search.value = "";
    search.dispatchEvent(new Event("input"));

    expect(pasivos.style.display).toBe("block");
    expect(fuentes.style.display).toBe("block");
    expect(fuentesHeader.classList.contains("active")).toBe(false);
    expect(fuentesContent.classList.contains("open")).toBe(false);
  });
});
