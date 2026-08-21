import Fuse, { type IFuseOptions } from "fuse.js";
import type { ParsedSubcircuit } from "../simulation/spice_library_parser";
import { openSpiceImportModal } from "./spice_import_modal";

export interface ComponentSearchItem {
  element: HTMLElement;
  id: string;
  type: string;
  name: string;
  description: string;
  category: string;
  defaultVal: string;
  tooltip: string;
  tags: string[];
}

const COMPONENT_TAGS_MAP: Record<string, string[]> = {
  resistor: ["resistencia", "resistor", "ohm", "potencia", "pasivo", "r", "1k", "divider", "divisor"],
  capacitor: ["condensador", "capacitor", "faradio", "cap", "filtro", "c", "1u", "desacoplo", "ceramico", "electrolitico"],
  inductor: ["inductor", "bobina", "henrio", "l", "choke", "filtro", "magnetico", "reactancia"],
  potentiometer: ["potenciometro", "pot", "variable", "reostato", "divisor", "trimmer", "ajustable"],
  ldr: ["fotorresistencia", "luz", "sensor", "ldr", "optico", "foto", "fotocelda", "lux"],
  thermistor: ["termistor", "temperatura", "sensor", "ntc", "ptc", "termico", "grados", "calor"],
  ground: ["tierra", "gnd", "ground", "0v", "referencia", "masa", "cero", "nodo 0"],
  dmm: ["multimetro", "dmm", "tester", "voltimetro", "amperimetro", "ohmetro", "medidor"],
  vsource: ["fuente de tension", "voltaje", "bateria", "vsource", "vcc", "power", "alimentacion", "dc", "pila", "generador"],
  isource: ["fuente de corriente", "corriente", "amperios", "isource", "intensidad", "generador corriente"],
  transformer: ["transformador", "trafo", "bobinado", "ac", "relacion vueltas", "aislacion"],
  diode: ["diodo", "rectificador", "pn", "silicio", "schottky", "zener", "conduccion"],
  nmos: ["mosfet nmos", "transistor", "n-channel", "canal n", "conmutador", "gate", "drain", "source"],
  pmos: ["mosfet pmos", "transistor", "p-channel", "canal p", "gate", "drain", "source"],
  npn: ["transistor npn", "bjt", "bipolar", "amplificador", "2n2222", "bc547", "base", "colector", "emisor"],
  pnp: ["transistor pnp", "bjt", "bipolar", "2n3906", "bc557", "base", "colector", "emisor"],
  led: ["diodo emisor de luz", "led", "iluminacion", "diodo", "luz", "rojo", "verde", "azul"],
  opto: ["optoacoplador", "aislador", "opto", "4n25", "4n35", "fototransistor", "aislamiento galvanico"],
  njf: ["jfet n", "transistor jfet", "canal n", "jfet", "jfet-n"],
  pjf: ["jfet p", "transistor jfet", "canal p", "jfet", "jfet-p"],
  bsim3nmos: ["bsim", "bsim3", "submicronico", "vlsi", "cmos", "ic", "nmos", "experimental"],
  bsim3pmos: ["bsim", "bsim3", "submicronico", "vlsi", "cmos", "ic", "pmos", "experimental"],
  opamp_ideal: ["amplificador operacional ideal", "opamp", "ao", "comparador", "inversor", "ganancia infinita"],
  opamp: ["amplificador operacional", "opamp", "ao", "tl081", "lm741", "ne5532", "inversor", "no inversor"],
  lamp: ["lampara", "bombilla", "foco", "filamento", "luz", "actuador", "termico"],
  relay: ["rele", "relay", "bobina", "contacto", "relevador", "conmutador electromecanico"],
  buzzer: ["zumbador", "buzzer", "altavoz", "audio", "tono", "bip", "sonido", "frecuencia"],
  switch: ["interruptor", "switch", "llave", "pulsador", "conmutador", "abierto", "cerrado"],
  and_gate: ["compuerta and", "y logica", "7408", "digital", "and", "logica"],
  or_gate: ["compuerta or", "o logica", "7432", "digital", "or", "logica"],
  not_gate: ["inversor", "compuerta not", "7404", "digital", "not", "negador"],
  nand_gate: ["compuerta nand", "no y", "7400", "digital", "nand", "universal"],
  nor_gate: ["compuerta nor", "no o", "7402", "digital", "nor", "universal"],
  xor_gate: ["compuerta xor", "or exclusiva", "7486", "digital", "xor", "paridad"],
  arduino_uno: ["arduino", "mcu", "atmega328p", "microcontrolador", "uno", "avr", "embedded"],
  esp32: ["esp32", "wifi", "bluetooth", "mcu", "espressif", "iot", "dual core"],
  raspberry_pi_pico: ["raspberry", "pico", "rp2040", "mcu", "arm", "cortex"],
  net_label: ["puerto de red", "net label", "vcc", "vdd", "gnd", "clk", "clock", "reloj", "+5v", "+3.3v", "+12v", "-12v", "alimentacion", "tierra", "bus", "vector", "signal", "etiqueta"],
  text_note: ["nota", "texto", "anotacion", "comentario", "descripcion", "esquema"],
  x: ["subcircuito", "macromodelo", "spice", "subckt", "chip", "dip", "ic", "modulo", "ne555", "timer", "555"],
};

function getElement<T extends Element>(parent: ParentNode, selector: string): T | null {
  return parent.querySelector<T>(selector);
}

function setCategoryOpen(header: HTMLElement, content: HTMLElement, open: boolean): void {
  content.classList.toggle("open", open);
  header.classList.toggle("active", open);
}

let fuseInstance: Fuse<ComponentSearchItem> | null = null;
let indexedItems: ComponentSearchItem[] = [];

/**
 * Extrae y construye los ítems indexables para Fuse.js a partir de las tarjetas de componentes del DOM.
 */
export function buildComponentSearchIndex(): ComponentSearchItem[] {
  const cards = document.querySelectorAll<HTMLElement>(".component-card");
  const items: ComponentSearchItem[] = [];

  cards.forEach((card) => {
    const type = card.dataset.type ?? "";
    const name = getElement<HTMLElement>(card, ".comp-name")?.textContent?.trim() ?? "";
    const description = getElement<HTMLElement>(card, ".comp-desc")?.textContent?.trim() ?? "";
    const defaultVal = card.dataset.default ?? "";
    const tooltip = card.dataset.tooltip ?? card.getAttribute("title") ?? "";
    const categoryGroup = card.closest(".category-group");
    const category = categoryGroup?.querySelector(".category-header")?.textContent?.trim() ?? "";

    const typeTags = COMPONENT_TAGS_MAP[type] ?? [];
    const customTags = [type, defaultVal, name.toLowerCase(), description.toLowerCase()];
    const allTags = Array.from(new Set([...typeTags, ...customTags])).filter((t) => t.length > 0);

    items.push({
      element: card,
      id: card.id,
      type,
      name,
      description,
      category,
      defaultVal,
      tooltip,
      tags: allTags,
    });
  });

  indexedItems = items;

  const fuseOptions: IFuseOptions<ComponentSearchItem> = {
    keys: [
      { name: "name", weight: 0.4 },
      { name: "tags", weight: 0.3 },
      { name: "description", weight: 0.15 },
      { name: "type", weight: 0.1 },
      { name: "category", weight: 0.05 },
    ],
    threshold: 0.35,
    distance: 80,
    minMatchCharLength: 2,
    includeScore: true,
    ignoreLocation: true,
  };

  fuseInstance = new Fuse(items, fuseOptions);
  return items;
}

function initComponentCategories(): void {
  const headers = document.querySelectorAll<HTMLElement>(".category-header");
  headers.forEach((header) => {
    header.addEventListener("click", () => {
      const content = header.nextElementSibling as HTMLElement | null;
      if (!content) return;

      setCategoryOpen(header, content, !content.classList.contains("open"));
    });
  });
}

function initComponentSearch(): void {
  const searchInput = document.querySelector<HTMLInputElement>("#component-search");
  if (!searchInput) return;

  buildComponentSearchIndex();

  searchInput.addEventListener("input", () => {
    const rawQuery = searchInput.value.trim();
    const categories = document.querySelectorAll<HTMLElement>(".category-group");

    if (rawQuery.length === 0) {
      // Restaurar visibilidad por defecto
      for (const item of indexedItems) {
        item.element.style.display = "flex";
      }

      categories.forEach((group) => {
        const header = getElement<HTMLElement>(group, ".category-header");
        const content = getElement<HTMLElement>(group, ".category-content");
        if (!header || !content) return;

        group.style.display = "block";
        setCategoryOpen(header, content, header.dataset.category === "pasivos");
      });
      return;
    }

    if (!fuseInstance) {
      buildComponentSearchIndex();
    }

    // Ejecutar búsqueda difusa (Fuzzy Search)
    const results = fuseInstance!.search(rawQuery);
    const matchedElements = new Set<HTMLElement>();

    for (const res of results) {
      matchedElements.add(res.item.element);
    }

    // Fallback: si la query es de 1 carácter o coincidencia directa de substring
    if (rawQuery.length === 1 || matchedElements.size === 0) {
      const lowerQ = rawQuery.toLowerCase();
      for (const item of indexedItems) {
        if (
          item.name.toLowerCase().includes(lowerQ) ||
          item.description.toLowerCase().includes(lowerQ) ||
          item.type.toLowerCase().includes(lowerQ) ||
          item.tags.some((t) => t.includes(lowerQ))
        ) {
          matchedElements.add(item.element);
        }
      }
    }

    // Actualizar visibilidad de tarjetas y categorías
    categories.forEach((group) => {
      const header = getElement<HTMLElement>(group, ".category-header");
      const content = getElement<HTMLElement>(group, ".category-content");
      if (!header || !content) return;

      const cards = content.querySelectorAll<HTMLElement>(".component-card");
      let visibleInGroup = 0;

      cards.forEach((card) => {
        const isMatch = matchedElements.has(card);
        card.style.display = isMatch ? "flex" : "none";
        if (isMatch) visibleInGroup++;
      });

      group.style.display = visibleInGroup > 0 ? "block" : "none";
      if (visibleInGroup > 0) {
        setCategoryOpen(header, content, true);
      }
    });
  });
}

function initSpiceImportTrigger(): void {
  const triggerBtn = document.querySelector<HTMLElement>("#btn-open-spice-import");
  if (triggerBtn) {
    triggerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSpiceImportModal();
    });
  }
}

/**
 * Añade dinámicamente un macromodelo SPICE parseado a la paleta interactiva y actualiza el índice de búsqueda.
 */
export function addSubcircuitCardToPalette(subckt: ParsedSubcircuit): HTMLElement | null {
  const container = document.querySelector<HTMLElement>("#cat-macromodelos");
  if (!container) return null;

  // Si ya existía una tarjeta con este nombre de modelo, reemplazarla
  const existingCard = container.querySelector<HTMLElement>(`[data-model-name="${subckt.name}"]`);
  if (existingCard) {
    existingCard.remove();
  }

  const card = document.createElement("div");
  card.className = "component-card dynamic-spice-card";
  card.id = `comp-spice-${subckt.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Colocar ${subckt.name}`);
  card.dataset.type = "x";
  card.dataset.default = subckt.name;
  card.dataset.modelName = subckt.name;
  card.dataset.pinCount = String(subckt.pinCount);
  card.dataset.pinLabels = JSON.stringify(subckt.pinLabels);
  card.dataset.spiceNetlist = subckt.rawNetlist;

  const pinsPreview = subckt.pinNames.slice(0, 4).join(", ") + (subckt.pinNames.length > 4 ? "..." : "");

  card.innerHTML = `
    <div class="comp-icon-box">
      <svg viewBox="0 0 40 40" class="comp-svg-icon" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="28" height="28" rx="3" stroke="#38BDF8" />
        <text x="20" y="24" text-anchor="middle" font-size="8" font-family="monospace" fill="#38BDF8">${subckt.name.slice(0, 5)}</text>
      </svg>
    </div>
    <div class="comp-details">
      <span class="comp-name">${subckt.name}</span>
      <span class="comp-desc">${subckt.pinCount} pines (${pinsPreview})</span>
    </div>
  `;

  container.appendChild(card);

  // Abrir la categoría de macromodelos
  const header = container.previousElementSibling as HTMLElement | null;
  if (header) {
    setCategoryOpen(header, container, true);
  }

  // Actualizar el índice de búsqueda fuzzy con el nuevo componente
  buildComponentSearchIndex();

  return card;
}

export function initComponentPaletteController(): void {
  initComponentCategories();
  initComponentSearch();
  initSpiceImportTrigger();
}
