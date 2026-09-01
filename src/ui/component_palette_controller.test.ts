// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  addSubcircuitCardToPalette,
  enableHorizontalScrollWithWheelAndDrag,
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

  it("renderiza metadatos SPICE hostiles como texto en la paleta dinámica", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();
    document.querySelector<HTMLButtonElement>("#btn-palette-view-list")!.click();

    const hostileName = "<img/onerror=alert(1)>";
    const hostileDescription = "<script>alert(2)</script>";
    const card = addSubcircuitCardToPalette({
      name: hostileName,
      pinNames: ["IN", "OUT"],
      pinCount: 2,
      pinLabels: { 0: "IN", 1: "OUT" },
      description: hostileDescription,
      category: "Macromodelos",
      suggestedType: "subcircuit",
      defaultParams: {},
      rawNetlist: `.SUBCKT ${hostileName} IN OUT\n.ENDS ${hostileName}`,
    });

    expect(card?.querySelector(".comp-name")?.textContent).toBe(hostileName);
    expect(card?.querySelector(".comp-desc")?.textContent).toContain(hostileName);
    expect(card?.querySelector("img, script, iframe, object, embed")).toBeNull();
    expect(card?.querySelector("[onerror], [onload], [onclick]")).toBeNull();

    document.querySelector<HTMLButtonElement>("#btn-palette-view-grid")!.click();
  });

  it("renderiza el catalogo completo de componentes de forma dinamica en #left-panel-body", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();

    const panelBody = document.querySelector<HTMLElement>("#left-panel-body")!;
    expect(panelBody.querySelector(".palette-top-sticky")).not.toBeNull();
    expect(panelBody.querySelector(".palette-header-bar")).not.toBeNull();
    expect(panelBody.querySelector(".palette-favorites-bar")).not.toBeNull();
    expect(panelBody.querySelector(".palette-category-pills")).not.toBeNull();
    expect(panelBody.querySelector(".components-categories")).not.toBeNull();

    // Comprobar tarjetas renderizadas
    const cards = panelBody.querySelectorAll(".component-card");
    expect(cards.length).toBeGreaterThan(20);
  });

  it("permite colapsar y expandir categorias despues de filtrar por pills", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();

    // Filtrar por Pasivos
    const pasivosPill = document.querySelector<HTMLButtonElement>('.palette-pill[data-category="pasivos"]')!;
    pasivosPill.click();

    const pasivosHeader = document.querySelector<HTMLElement>("#group-pasivos .category-header")!;
    const pasivosContent = document.querySelector<HTMLElement>("#cat-pasivos")!;

    expect(pasivosContent.classList.contains("open")).toBe(true);

    // Clic en header para colapsar
    pasivosHeader.click();
    expect(pasivosContent.classList.contains("open")).toBe(false);
    expect(pasivosHeader.classList.contains("active")).toBe(false);

    // Clic en header para reabrir
    pasivosHeader.click();
    expect(pasivosContent.classList.contains("open")).toBe(true);
    expect(pasivosHeader.classList.contains("active")).toBe(true);
  });

  it("conmuta la vista entre Grid y Lista tecnica y persiste la seleccion", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();

    const btnList = document.querySelector<HTMLButtonElement>("#btn-palette-view-list")!;
    const btnGrid = document.querySelector<HTMLButtonElement>("#btn-palette-view-grid")!;

    btnList.click();
    expect(localStorage.getItem("astryd_palette_view_mode")).toBe("list");
    expect(document.querySelector(".category-content")?.classList.contains("view-list")).toBe(true);

    btnGrid.click();
    expect(localStorage.getItem("astryd_palette_view_mode")).toBe("grid");
    expect(document.querySelector(".category-content")?.classList.contains("view-grid")).toBe(true);
  });

  it("conmuta la norma de simbologia entre IEEE e IEC", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();

    const btnIec = document.querySelector<HTMLButtonElement>("#btn-std-iec")!;
    btnIec.click();
    expect(localStorage.getItem("astryd_palette_symbol_std")).toBe("IEC");

    const btnIeee = document.querySelector<HTMLButtonElement>("#btn-std-ieee")!;
    btnIeee.click();
    expect(localStorage.getItem("astryd_palette_symbol_std")).toBe("IEEE");
  });

  it("arma y desarma la herramienta Stamp al hacer clic en tarjetas o chips de favoritos", () => {
    document.body.innerHTML = `<div id="left-panel-body"></div>`;
    initComponentPaletteController();

    const resistorCard = document.querySelector<HTMLElement>('.component-card[data-type="resistor"]')!;
    resistorCard.click();

    expect(resistorCard.classList.contains("palette-card-armed")).toBe(true);

    // Clic de nuevo para desarmar
    resistorCard.click();
    expect(resistorCard.classList.contains("palette-card-armed")).toBe(false);
  });

  it("permite el desplazamiento horizontal de la barra de categorias con la rueda del raton y arrastre", () => {
    const container = document.createElement("div");
    container.scrollLeft = 0;
    enableHorizontalScrollWithWheelAndDrag(container);

    // 1. Evento wheel vertical -> scrollLeft
    const wheelEvent = new WheelEvent("wheel", { deltaY: 50, deltaX: 0, cancelable: true });
    container.dispatchEvent(wheelEvent);
    expect(container.scrollLeft).toBe(50);

    // 2. Evento wheel horizontal nativo (touchpad) -> no debe duplicarse ni sobreescribirse
    const trackpadWheel = new WheelEvent("wheel", { deltaY: 0, deltaX: 30, cancelable: true });
    container.dispatchEvent(trackpadWheel);
    expect(container.scrollLeft).toBe(50);

    // 3. Arrastre de ratón (mouse drag)
    const mousedown = new MouseEvent("mousedown", { button: 0, clientX: 100 });
    Object.defineProperty(mousedown, "pageX", { value: 100 });
    container.dispatchEvent(mousedown);

    const mousemove = new MouseEvent("mousemove", { clientX: 70 });
    Object.defineProperty(mousemove, "pageX", { value: 70 });
    container.dispatchEvent(mousemove);

    // Arrastró 30px hacia la izquierda -> scrollLeft aumenta en 30px (50 + 30 = 80)
    expect(container.scrollLeft).toBe(80);

    const mouseup = new MouseEvent("mouseup", {});
    container.dispatchEvent(mouseup);
  });
});
