// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  addSubcircuitCardToPalette,
  initComponentPaletteController,
} from "./component_palette_controller";
import type { ParsedSubcircuit } from "../simulation/spice_library_parser";

afterEach(() => {
  document.body.innerHTML = "";
});

function setupDom(): void {
  document.body.innerHTML = `
    <input id="component-search" />
    <section class="category-group" id="pasivos">
      <button class="category-header active" data-category="pasivos">Pasivos</button>
      <div class="category-content open">
        <button class="component-card" id="comp-resistor" data-type="resistor" data-default="1000">
          <span class="comp-name">Resistor</span>
          <span class="comp-desc">Resistencia 1k</span>
        </button>
        <button class="component-card" id="comp-capacitor" data-type="capacitor" data-default="1u">
          <span class="comp-name">Capacitor</span>
          <span class="comp-desc">Condensador 1uF</span>
        </button>
      </div>
    </section>
    <section class="category-group" id="fuentes">
      <button class="category-header" data-category="fuentes">Fuentes</button>
      <div class="category-content">
        <button class="component-card" id="comp-vsource" data-type="vsource" data-default="5" data-tooltip="Fuente de tension continua">
          <span class="comp-name">Fuente DC</span>
          <span class="comp-desc">Tension continua</span>
        </button>
      </div>
    </section>
    <section class="category-group" id="group-macromodelos">
      <div class="category-header" data-category="macromodelos">
        <span>Macromodelos</span>
        <button id="btn-open-spice-import">+ SPICE</button>
      </div>
      <div class="category-content" id="cat-macromodelos">
        <div class="component-card" id="comp-subcircuit" data-type="x" data-default="1">
          <span class="comp-name">Subcircuito Genérico</span>
          <span class="comp-desc">Macromodelo SPICE</span>
        </div>
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

  it("encuentra componentes con búsqueda difusa (Fuzzy Search) tolerante a errores tipográficos", () => {
    setupDom();
    initComponentPaletteController();

    const search = document.querySelector<HTMLInputElement>("#component-search")!;
    const pasivos = document.querySelector<HTMLElement>("#pasivos")!;
    const resistorCard = document.querySelector<HTMLElement>("#comp-resistor")!;
    const capacitorCard = document.querySelector<HTMLElement>("#comp-capacitor")!;

    // Búsqueda con error tipográfico "resitorr"
    search.value = "resitorr";
    search.dispatchEvent(new Event("input"));

    expect(pasivos.style.display).toBe("block");
    expect(resistorCard.style.display).toBe("flex");
    expect(capacitorCard.style.display).toBe("none");
  });

  it("encuentra componentes por sinónimos, tags y parámetros técnicos", () => {
    setupDom();
    initComponentPaletteController();

    const search = document.querySelector<HTMLInputElement>("#component-search")!;
    const pasivos = document.querySelector<HTMLElement>("#pasivos")!;
    const fuentes = document.querySelector<HTMLElement>("#fuentes")!;
    const capacitorCard = document.querySelector<HTMLElement>("#comp-capacitor")!;
    const vsourceCard = document.querySelector<HTMLElement>("#comp-vsource")!;

    // Búsqueda por tag "faradio" (tag de capacitor)
    search.value = "faradio";
    search.dispatchEvent(new Event("input"));

    expect(pasivos.style.display).toBe("block");
    expect(capacitorCard.style.display).toBe("flex");
    expect(fuentes.style.display).toBe("none");

    // Búsqueda por tag "bateria" (tag de vsource)
    search.value = "bateria";
    search.dispatchEvent(new Event("input"));

    expect(fuentes.style.display).toBe("block");
    expect(vsourceCard.style.display).toBe("flex");
    expect(pasivos.style.display).toBe("none");
  });

  it("agrega tarjetas dinamicas de macromodelos SPICE a la paleta y las indexa para fuzzy search", () => {
    setupDom();
    initComponentPaletteController();

    const subckt: ParsedSubcircuit = {
      name: "LM741",
      pinNames: ["IN+", "IN-", "VCC", "VEE", "OUT"],
      pinCount: 5,
      pinLabels: { 0: "IN+", 1: "IN-", 2: "VCC", 3: "VEE", 4: "OUT" },
      description: "OpAmp LM741 TI Amplificador",
      category: "Amplificadores",
      suggestedType: "opamp",
      defaultParams: { GAIN: 200000 },
      rawNetlist: ".SUBCKT LM741 IN+ IN- VCC VEE OUT\n.ENDS LM741",
    };

    const card = addSubcircuitCardToPalette(subckt);

    expect(card).not.toBeNull();
    expect(card?.dataset.type).toBe("x");
    expect(card?.dataset.modelName).toBe("LM741");
    expect(card?.dataset.pinCount).toBe("5");
    expect(card?.querySelector(".comp-name")?.textContent).toBe("LM741");

    const catContainer = document.querySelector<HTMLElement>("#cat-macromodelos")!;
    expect(catContainer.querySelector("#comp-spice-lm741")).not.toBeNull();

    // Comprobar búsqueda difusa sobre el nuevo macromodelo indexado dinámicamente
    const search = document.querySelector<HTMLInputElement>("#component-search")!;
    const macromodelosGroup = document.querySelector<HTMLElement>("#group-macromodelos")!;

    search.value = "lm741";
    search.dispatchEvent(new Event("input"));

    expect(macromodelosGroup.style.display).toBe("block");
    expect(card?.style.display).toBe("flex");
  });
});
