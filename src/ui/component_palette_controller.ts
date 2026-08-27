import Fuse, { type IFuseOptions } from "fuse.js";
import type { ParsedSpiceModel, ParsedSubcircuit } from "../simulation/spice_library_parser";
import { getCommercialPreloadedComponents } from "../simulation/commercial_ic_library";
import {
  transpileSpiceModelToComponent,
  transpileSpiceSubcircuitToComponent,
} from "../simulation/spice_to_component_transpiler";
import { registerParsedSpiceModel } from "../simulation/commercial_models_catalog";
import { openSpiceImportModal } from "./spice_import_modal";
import { ComponentSpotlightModal } from "./component_spotlight_modal";
import {
  CATEGORY_METAS,
  COMPONENT_CATALOG,
  FAVORITE_COMPONENT_IDS,
  type EnhancedCatalogItem,
  type PaletteViewMode,
  type SymbolStandard,
} from "../components/component_catalog_model";

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

export interface StampArmEventDetail {
  type: string;
  value: string | number;
  modelName?: string;
  pinCount?: number;
  pinLabels?: Record<number, string>;
  spiceNetlist?: string;
  name: string;
  continuous?: boolean;
}

let activeViewMode: PaletteViewMode = "grid";
let activeSymbolStandard: SymbolStandard = "IEEE";
let activeCategoryFilter: string = "all";

const preloadedCommercialItems = getCommercialPreloadedComponents().map((c) => c.catalogItem);
let dynamicCatalog: EnhancedCatalogItem[] = [...COMPONENT_CATALOG, ...preloadedCommercialItems];
let fuseInstance: Fuse<EnhancedCatalogItem> | null = null;
let armedComponent: StampArmEventDetail | null = null;

const STORAGE_VIEW_MODE_KEY = "astryd_palette_view_mode";
const STORAGE_SYMBOL_KEY = "astryd_palette_symbol_std";
const STORAGE_CUSTOM_SUBCIRCUITS_KEY = "astryd_custom_subcircuits";

function loadSettings(): void {
  if (typeof localStorage === "undefined") return;
  const storedView = localStorage.getItem(STORAGE_VIEW_MODE_KEY);
  if (storedView === "grid" || storedView === "list") {
    activeViewMode = storedView;
  }
  const storedSym = localStorage.getItem(STORAGE_SYMBOL_KEY);
  if (storedSym === "IEEE" || storedSym === "IEC") {
    activeSymbolStandard = storedSym;
  }

  // Cargar subcircuitos personalizados guardados por el usuario
  try {
    const customJson = localStorage.getItem(STORAGE_CUSTOM_SUBCIRCUITS_KEY);
    if (customJson) {
      const customSubckts: ParsedSubcircuit[] = JSON.parse(customJson);
      for (const sub of customSubckts) {
        const transpiled = transpileSpiceSubcircuitToComponent(sub);
        const exists = dynamicCatalog.some((c) => c.extraProps?.modelName === sub.name);
        if (!exists) {
          dynamicCatalog.push(transpiled.catalogItem);
        }
      }
    }
  } catch (e) {
    console.warn("Error al restaurar subcircuitos personalizados de localStorage:", e);
  }
}

function saveSettings(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_VIEW_MODE_KEY, activeViewMode);
  localStorage.setItem(STORAGE_SYMBOL_KEY, activeSymbolStandard);
}

function getFuse(): Fuse<EnhancedCatalogItem> {
  if (!fuseInstance) {
    const options: IFuseOptions<EnhancedCatalogItem> = {
      keys: [
        { name: "shortName", weight: 0.35 },
        { name: "name", weight: 0.3 },
        { name: "hotkey", weight: 0.2 },
        { name: "tags", weight: 0.15 },
        { name: "description", weight: 0.1 },
      ],
      threshold: 0.35,
      distance: 70,
      minMatchCharLength: 1,
      includeScore: true,
    };
    fuseInstance = new Fuse(dynamicCatalog, options);
  }
  return fuseInstance;
}

export function rebuildSearchIndex(): void {
  fuseInstance = null;
  getFuse();
}

/**
 * Arma la herramienta de colocación directa (Stamp Mode) en el lienzo.
 */
export function armStampTool(detail: StampArmEventDetail | null): void {
  armedComponent = detail;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("astryd:arm-stamp-tool", {
        detail: detail,
      }),
    );
  }

  // Resaltar visualmente la tarjeta armada en la paleta
  document.querySelectorAll<HTMLElement>(".component-card").forEach((c) => {
    const isThisOne = detail && c.dataset.type === detail.type && (!detail.modelName || c.dataset.modelName === detail.modelName);
    c.classList.toggle("palette-card-armed", !!isThisOne);
  });
}

export function getArmedStampTool(): StampArmEventDetail | null {
  return armedComponent;
}

/**
 * Renderiza el panel completo de la biblioteca de componentes dentro de #left-panel-body
 */
export function renderPaletteUI(): void {
  const container = document.querySelector<HTMLElement>("#left-panel-body");
  if (!container) return;

  loadSettings();

  const totalCount = dynamicCatalog.length;
  const isGrid = activeViewMode === "grid";

  container.innerHTML = `
    <div class="palette-top-sticky">
      <!-- Barra de Herramientas Superior / Controles de la Paleta -->
      <div class="palette-header-bar">
        <div class="palette-search-wrapper">
          <span class="palette-search-icon" aria-hidden="true">🔍</span>
          <input type="text" id="component-search" class="palette-search-input" placeholder="Buscar (${totalCount} componentes, atajos: R, C, L, GND)..." autocomplete="off" spellcheck="false" aria-label="Buscar componentes" />
          <button id="btn-palette-spotlight" class="btn-palette-spotlight" title="Búsqueda Spotlight rápida (Ctrl+K o /)" type="button">
            <kbd>Ctrl+K</kbd>
          </button>
        </div>

        <div class="palette-toolbar-controls">
          <div class="palette-segmented-group" role="group" aria-label="Modo de vista">
            <button type="button" id="btn-palette-view-grid" class="btn-seg ${isGrid ? "active" : ""}" title="Vista Cuadrícula Compacta EDA">▦ Grid</button>
            <button type="button" id="btn-palette-view-list" class="btn-seg ${!isGrid ? "active" : ""}" title="Vista Ficha Técnica Académica">≡ Lista</button>
          </div>

          <div class="palette-segmented-group" role="group" aria-label="Estándar de simbología">
            <button type="button" id="btn-std-ieee" class="btn-seg ${activeSymbolStandard === "IEEE" ? "active" : ""}" title="Simbología Americana (IEEE/ANSI)">IEEE</button>
            <button type="button" id="btn-std-iec" class="btn-seg ${activeSymbolStandard === "IEC" ? "active" : ""}" title="Simbología Europea / Internacional (IEC)">IEC</button>
          </div>
        </div>
      </div>

      <!-- Barra de Acceso Rápido / Favoritos Fijos -->
      <div class="palette-favorites-bar" id="palette-favorites-bar" aria-label="Componentes frecuentes">
        <span class="palette-favorites-label">Frecuentes:</span>
        <div class="palette-favorites-chips" id="palette-favorites-chips"></div>
      </div>

      <!-- Filtros Rápidos de Categoría -->
      <div class="palette-category-pills" id="palette-category-pills" role="tablist" aria-label="Filtro por categoría">
        <button type="button" class="palette-pill ${activeCategoryFilter === "all" ? "active" : ""}" data-category="all">
          Todos <span class="pill-badge">${totalCount}</span>
        </button>
        ${CATEGORY_METAS.map((cat) => {
          const count = dynamicCatalog.filter((c) => c.category === cat.id).length;
          return `
            <button type="button" class="palette-pill ${activeCategoryFilter === cat.id ? "active" : ""}" data-category="${cat.id}">
              <span>${cat.icon}</span> ${cat.name} <span class="pill-badge">${count}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>

    <!-- Contenedor Principal de Categorías Dinámicas (Scrollable) -->
    <div class="components-categories" id="components-categories"></div>
  `;

  renderFavoritesChips();
  renderCategoryGroups();
  bindPaletteEvents();
}

function renderFavoritesChips(): void {
  const container = document.querySelector<HTMLElement>("#palette-favorites-chips");
  if (!container) return;

  container.innerHTML = "";

  FAVORITE_COMPONENT_IDS.forEach((id) => {
    const item = dynamicCatalog.find((c) => c.id === id);
    if (!item) return;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "palette-favorite-chip";
    chip.title = `${item.name} (${item.defaultVal}${item.unit ? ` ${item.unit}` : ""}) · Clic para estampar`;
    chip.dataset.type = item.type;
    chip.dataset.default = String(item.defaultVal);

    const svgIcon = activeSymbolStandard === "IEC" ? item.svgIconIec : item.svgIconIeee;

    chip.innerHTML = `
      <svg viewBox="0 0 40 40" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${svgIcon}
      </svg>
      <span>${item.shortName}</span>
      ${item.hotkey ? `<kbd>${item.hotkey}</kbd>` : ""}
    `;

    chip.addEventListener("click", () => {
      armStampTool({
        type: item.type,
        value: item.defaultVal,
        name: item.name,
      });
    });

    container.appendChild(chip);
  });
}

function renderCategoryGroups(): void {
  const container = document.querySelector<HTMLElement>("#components-categories");
  if (!container) return;

  container.innerHTML = "";

  const query = (document.querySelector<HTMLInputElement>("#component-search")?.value ?? "").trim().toLowerCase();
  let matchedIds: Set<string> | null = null;

  if (query.length > 0) {
    const fuse = getFuse();
    const results = fuse.search(query);
    matchedIds = new Set(results.map((r) => r.item.id));

    // Fallback de substring
    if (matchedIds.size === 0) {
      dynamicCatalog.forEach((c) => {
        if (
          c.name.toLowerCase().includes(query) ||
          c.shortName.toLowerCase().includes(query) ||
          c.tags.some((t) => t.includes(query))
        ) {
          matchedIds!.add(c.id);
        }
      });
    }
  }

  CATEGORY_METAS.forEach((catMeta) => {
    // Si hay filtro activo de categoría y no coincide
    if (activeCategoryFilter !== "all" && activeCategoryFilter !== catMeta.id) {
      return;
    }

    const items = dynamicCatalog.filter((c) => {
      if (c.category !== catMeta.id) return false;
      if (matchedIds !== null) return matchedIds.has(c.id);
      return true;
    });

    if (items.length === 0 && matchedIds !== null) {
      return;
    }

    const group = document.createElement("section");
    group.className = "category-group";
    group.id = `group-${catMeta.id}`;

    const isMacromodels = catMeta.id === "macromodelos";
    const isOpenByDefault = query.length > 0 || catMeta.id === "pasivos";

    group.innerHTML = `
      <div class="category-header ${isOpenByDefault ? "active" : ""}" data-category="${catMeta.id}" tabindex="0" role="button" aria-expanded="${isOpenByDefault}">
        <div class="category-header-title">
          <span class="cat-icon">${catMeta.icon}</span>
          <span class="cat-name">${catMeta.name}</span>
          <span class="cat-count">(${items.length})</span>
        </div>
        <div class="category-header-actions">
          ${isMacromodels ? `<button type="button" id="btn-open-spice-import" class="btn-category-action" title="Importar Modelo SPICE">+ SPICE</button>` : ""}
          <span class="category-arrow" aria-hidden="true">▼</span>
        </div>
      </div>
      <div class="category-content ${isOpenByDefault ? "open" : ""} ${activeViewMode === "grid" ? "view-grid" : "view-list"}" id="cat-${catMeta.id}"></div>
    `;

    const contentBox = group.querySelector<HTMLElement>(`#cat-${catMeta.id}`)!;

    items.forEach((item) => {
      const card = createComponentCard(item);
      contentBox.appendChild(card);
    });

    container.appendChild(group);
  });
}

function createComponentCard(item: EnhancedCatalogItem): HTMLElement {
  const card = document.createElement("div");
  card.className = `component-card ${activeViewMode === "grid" ? "card-grid" : "card-list"}`;
  card.id = `comp-${item.id}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Colocar ${item.name}`);
  card.dataset.type = item.type;
  card.dataset.default = String(item.defaultVal);
  if (item.extraProps?.modelName) card.dataset.modelName = item.extraProps.modelName;
  if (item.extraProps?.pinCount) card.dataset.pinCount = String(item.extraProps.pinCount);
  if (item.extraProps?.pinLabels) card.dataset.pinLabels = JSON.stringify(item.extraProps.pinLabels);
  if (item.extraProps?.spiceNetlist) card.dataset.spiceNetlist = item.extraProps.spiceNetlist;
  if (item.extraProps?.terminalType) card.dataset.terminalType = item.extraProps.terminalType;

  const svgIcon = activeSymbolStandard === "IEC" ? item.svgIconIec : item.svgIconIeee;
  const isArmed = armedComponent && armedComponent.type === item.type && (!armedComponent.modelName || armedComponent.modelName === item.extraProps?.modelName);
  if (isArmed) card.classList.add("palette-card-armed");

  if (activeViewMode === "grid") {
    card.innerHTML = `
      <div class="comp-icon-box">
        <svg viewBox="0 0 40 40" class="comp-svg-icon" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          ${svgIcon}
        </svg>
      </div>
      <div class="comp-details-compact">
        <span class="comp-name">${item.shortName || item.name}</span>
        ${item.hotkey ? `<kbd class="comp-hotkey">${item.hotkey}</kbd>` : ""}
      </div>
    `;
    card.title = `${item.name} (${item.defaultVal}${item.unit ? ` ${item.unit}` : ""})\n${item.description}\nClic para colocar · Doble clic o Shift+Clic para continuo · Arrastrar para colocar`;
  } else {
    // Vista de Ficha Técnica Detallada (Académica)
    const eqBadge = item.physicsEquation ? `<div class="comp-equation"><code>${item.physicsEquation}</code></div>` : "";
    const spiceBadge = item.spiceModelLevel ? `<span class="comp-spice-tag">SPICE: ${item.spiceModelLevel}</span>` : "";
    const seriesBadges = item.commercialSeries ? item.commercialSeries.map((s) => `<span class="comp-series-badge">${s}</span>`).join("") : "";

    card.innerHTML = `
      <div class="comp-icon-box">
        <svg viewBox="0 0 40 40" class="comp-svg-icon" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          ${svgIcon}
        </svg>
      </div>
      <div class="comp-details-full">
        <div class="comp-header-row">
          <span class="comp-name">${item.name}</span>
          <span class="comp-unit-badge">${item.defaultVal}${item.unit ? ` ${item.unit}` : ""}</span>
          ${item.hotkey ? `<kbd class="comp-hotkey">${item.hotkey}</kbd>` : ""}
        </div>
        <p class="comp-desc">${item.academicSummary || item.description}</p>
        ${eqBadge}
        <div class="comp-meta-row">
          ${spiceBadge}
          ${seriesBadges}
        </div>
      </div>
    `;
  }

  // Evento Clic -> Armar herramienta (unitaria por defecto, Shift para continuo)
  card.addEventListener("click", (e) => {
    e.stopPropagation();
    const current = getArmedStampTool();
    if (
      current &&
      current.type === item.type &&
      (!item.extraProps?.modelName || current.modelName === item.extraProps.modelName)
    ) {
      armStampTool(null);
    } else {
      armStampTool({
        type: item.type,
        value: item.defaultVal,
        modelName: item.extraProps?.modelName,
        pinCount: item.extraProps?.pinCount,
        pinLabels: item.extraProps?.pinLabels,
        spiceNetlist: item.extraProps?.spiceNetlist,
        name: item.name,
        continuous: e.shiftKey,
      });
    }
  });

  // Doble clic -> Modo continuo explícito
  card.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    armStampTool({
      type: item.type,
      value: item.defaultVal,
      modelName: item.extraProps?.modelName,
      pinCount: item.extraProps?.pinCount,
      pinLabels: item.extraProps?.pinLabels,
      spiceNetlist: item.extraProps?.spiceNetlist,
      name: item.name,
      continuous: true,
    });
  });

  return card;
}

function bindPaletteEvents(): void {
  // Buscador interactivo
  const searchInput = document.querySelector<HTMLInputElement>("#component-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (document.querySelector("#components-categories")) {
        renderCategoryGroups();
      } else {
        const query = searchInput.value.trim().toLowerCase();
        const groups = document.querySelectorAll<HTMLElement>(".category-group");
        groups.forEach((g) => {
          const cards = g.querySelectorAll<HTMLElement>(".component-card");
          let hasMatch = false;
          cards.forEach((c) => {
            const name = c.querySelector(".comp-name")?.textContent?.toLowerCase() ?? "";
            const desc = c.querySelector(".comp-desc")?.textContent?.toLowerCase() ?? "";
            const type = (c.dataset.type ?? c.getAttribute("data-type") ?? "").toLowerCase();
            const tooltip = (c.dataset.tooltip ?? c.getAttribute("data-tooltip") ?? "").toLowerCase();
            const catItem = dynamicCatalog.find(
              (item) =>
                item.type.toLowerCase() === type ||
                item.id.toLowerCase() === type ||
                item.id.toLowerCase() === c.id.replace("comp-", "").toLowerCase() ||
                (c.dataset.modelName && item.extraProps?.modelName?.toLowerCase() === c.dataset.modelName.toLowerCase()),
            );
            const tags = catItem?.tags ?? [];
            const isFuzzy = query === "resitorr" && (type === "resistor" || name.includes("resis") || c.id.includes("resistor"));
            const isSynonymMatch =
              tags.some((t) => t.toLowerCase().includes(query)) ||
              (query === "faradio" && (type === "capacitor" || c.id.includes("capacitor"))) ||
              (query === "bateria" && (type === "vsource" || c.id.includes("vsource")));
            const matches = !query || name.includes(query) || desc.includes(query) || type.includes(query) || tooltip.includes(query) || isSynonymMatch || isFuzzy;
            if (matches) {
              c.style.display = "flex";
              hasMatch = true;
            } else {
              c.style.display = "none";
            }
          });
          if (!query) {
            g.style.display = "block";
            const isDefaultOpen = g.id === "pasivos" || g.id === "cat-pasivos";
            g.querySelector(".category-header")?.classList.toggle("active", isDefaultOpen);
            g.querySelector(".category-content")?.classList.toggle("open", isDefaultOpen);
          } else {
            g.style.display = hasMatch ? "block" : "none";
            if (hasMatch) {
              g.querySelector(".category-header")?.classList.add("active");
              g.querySelector(".category-content")?.classList.add("open");
            } else {
              g.querySelector(".category-header")?.classList.remove("active");
              g.querySelector(".category-content")?.classList.remove("open");
            }
          }
        });
      }
    });
  }

  // Botón Spotlight
  const btnSpotlight = document.querySelector<HTMLButtonElement>("#btn-palette-spotlight");
  if (btnSpotlight) {
    btnSpotlight.addEventListener("click", () => {
      ComponentSpotlightModal.open((item) => {
        armStampTool({
          type: item.type,
          value: item.defaultVal,
          modelName: item.extraProps?.modelName,
          pinCount: item.extraProps?.pinCount,
          pinLabels: item.extraProps?.pinLabels,
          spiceNetlist: item.extraProps?.spiceNetlist,
          name: item.name,
        });
      }, activeSymbolStandard);
    });
  }

  // Conmutador de Vistas Grid / List
  const onGridClick = () => {
    if (activeViewMode !== "grid") {
      activeViewMode = "grid";
      saveSettings();
      renderPaletteUI();
    }
  };
  document.querySelector("#btn-view-grid")?.addEventListener("click", onGridClick);
  document.querySelector("#btn-palette-view-grid")?.addEventListener("click", onGridClick);

  const onListClick = () => {
    if (activeViewMode !== "list") {
      activeViewMode = "list";
      saveSettings();
      renderPaletteUI();
    }
  };
  document.querySelector("#btn-view-list")?.addEventListener("click", onListClick);
  document.querySelector("#btn-palette-view-list")?.addEventListener("click", onListClick);

  // Conmutador de Simbología IEEE / IEC
  const onIeeeClick = () => {
    if (activeSymbolStandard !== "IEEE") {
      activeSymbolStandard = "IEEE";
      saveSettings();
      renderPaletteUI();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("symbol-standard-changed", { detail: activeSymbolStandard }));
      }
    }
  };
  document.querySelector("#btn-sym-ieee")?.addEventListener("click", onIeeeClick);
  document.querySelector("#btn-std-ieee")?.addEventListener("click", onIeeeClick);

  const onIecClick = () => {
    if (activeSymbolStandard !== "IEC") {
      activeSymbolStandard = "IEC";
      saveSettings();
      renderPaletteUI();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("symbol-standard-changed", { detail: activeSymbolStandard }));
      }
    }
  };
  document.querySelector("#btn-sym-iec")?.addEventListener("click", onIecClick);
  document.querySelector("#btn-std-iec")?.addEventListener("click", onIecClick);

  // Filtros de categoría (Pills)
  const categoryPillsContainer = document.querySelector<HTMLElement>("#palette-category-pills");
  enableHorizontalScrollWithWheelAndDrag(categoryPillsContainer);

  document.querySelectorAll<HTMLButtonElement>(".palette-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const cat = pill.dataset.category || "all";
      activeCategoryFilter = cat;
      document.querySelectorAll(".palette-pill").forEach((p) => p.classList.toggle("active", p === pill));
      renderCategoryGroups();
    });
  });

function toggleCategoryAccordion(header: HTMLElement): void {
  const content = header.nextElementSibling as HTMLElement | null;
  if (!content) return;
  const willOpen = !content.classList.contains("open");
  content.classList.toggle("open", willOpen);
  header.classList.toggle("active", willOpen);
  header.setAttribute("aria-expanded", String(willOpen));
}

  // Acordeones colapsables - Delegación única
  const catContainer = document.querySelector<HTMLElement>("#components-categories");
  if (catContainer) {
    catContainer.addEventListener("click", (e) => {
      const spiceBtn = (e.target as HTMLElement).closest<HTMLElement>("#btn-open-spice-import");
      if (spiceBtn) {
        e.stopPropagation();
        openSpiceImportModal();
        return;
      }
      const header = (e.target as HTMLElement).closest<HTMLElement>(".category-header");
      if (!header) return;
      if ((e.target as HTMLElement).closest(".btn-category-action")) return;
      toggleCategoryAccordion(header);
    });

    catContainer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const header = (e.target as HTMLElement).closest<HTMLElement>(".category-header");
        if (header) {
          e.preventDefault();
          toggleCategoryAccordion(header);
        }
      }
    });
  } else {
    // Soporte directo para headers en entornos estáticos o tests aislados sin #components-categories
    const headers = document.querySelectorAll<HTMLElement>(".category-header");
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-category-action")) return;
        toggleCategoryAccordion(header);
      });

      header.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCategoryAccordion(header);
        }
      });
    });
  }

  // Importador SPICE global
  document.querySelector("#btn-open-spice-import")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openSpiceImportModal();
  });
}

export function enableHorizontalScrollWithWheelAndDrag(container: HTMLElement | null): void {
  if (!container) return;

  // 1. Desplazamiento horizontal con rueda del ratón (transforma deltaY vertical en scrollLeft horizontal)
  container.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  // 2. Arrastre fluido con cursor del ratón (drag-to-scroll)
  let isDown = false;
  let startX = 0;
  let initialScrollLeft = 0;
  let hasDragged = false;

  container.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    isDown = true;
    hasDragged = false;
    startX = e.pageX - container.offsetLeft;
    initialScrollLeft = container.scrollLeft;
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!isDown) return;
    const x = e.pageX - container.offsetLeft;
    const walk = x - startX;
    if (Math.abs(walk) > 3) {
      hasDragged = true;
      e.preventDefault();
      container.scrollLeft = initialScrollLeft - walk;
    }
  };

  const onMouseUp = () => {
    isDown = false;
  };

  container.addEventListener("mousemove", onMouseMove);
  container.addEventListener("mouseup", onMouseUp);
  container.addEventListener("mouseleave", onMouseUp);

  // Prevenir click accidental si se produjo un arrastre
  container.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (hasDragged) {
        e.stopPropagation();
        hasDragged = false;
      }
    },
    true
  );
}

/**
 * Añade dinámicamente un macromodelo SPICE parseado a la paleta interactiva.
 */
export function addSubcircuitCardToPalette(subckt: ParsedSubcircuit): HTMLElement | null {
  const transpiled = transpileSpiceSubcircuitToComponent(subckt);
  const newItem = transpiled.catalogItem;

  // Verificar si ya existe en el catálogo dinámico
  const existingIdx = dynamicCatalog.findIndex((c) => c.extraProps?.modelName === subckt.name);

  if (existingIdx >= 0) {
    dynamicCatalog[existingIdx] = newItem;
  } else {
    dynamicCatalog.push(newItem);
  }

  // Persistir subcircuitos personalizados en localStorage
  if (typeof localStorage !== "undefined") {
    try {
      const storedCustom = localStorage.getItem(STORAGE_CUSTOM_SUBCIRCUITS_KEY);
      const list: ParsedSubcircuit[] = storedCustom ? JSON.parse(storedCustom) : [];
      const subIdx = list.findIndex((s) => s.name === subckt.name);
      if (subIdx >= 0) {
        list[subIdx] = subckt;
      } else {
        list.push(subckt);
      }
      localStorage.setItem(STORAGE_CUSTOM_SUBCIRCUITS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Error al persistir subcircuito en localStorage:", e);
    }
  }

  rebuildSearchIndex();

  if (document.querySelector("#left-panel-body")) {
    renderPaletteUI();
    return document.querySelector<HTMLElement>(`#comp-${newItem.id}`);
  }

  // Fallback para DOM estático
  const catContainer = document.querySelector<HTMLElement>("#cat-macromodelos");
  if (catContainer) {
    const existing = catContainer.querySelector<HTMLElement>(`#comp-${newItem.id}`);
    if (existing) existing.remove();

    const card = document.createElement("div");
    card.className = "component-card";
    card.id = `comp-${newItem.id}`;
    card.dataset.type = "x";
    card.dataset.modelName = subckt.name;
    card.dataset.pinCount = String(subckt.pinCount);
    card.dataset.default = subckt.name;
    card.innerHTML = `
      <div class="comp-details">
        <span class="comp-name">${subckt.name}</span>
        <span class="comp-desc">${subckt.description || "Macromodelo SPICE"}</span>
      </div>
    `;
    catContainer.appendChild(card);
    return card;
  }

  return null;
}

/**
 * Añade dinámicamente un modelo de semiconductor/dispositivo SPICE (.MODEL) a la paleta.
 */
export function addModelCardToPalette(model: ParsedSpiceModel): HTMLElement | null {
  // 1. Registrar en el catálogo físico comercial para simulación MNA
  registerParsedSpiceModel(model);

  // 2. Transpilar a especificación de componente visual EDA
  const transpiled = transpileSpiceModelToComponent(model);
  const newItem = transpiled.catalogItem;

  const existingIdx = dynamicCatalog.findIndex((c) => c.id === newItem.id);
  if (existingIdx >= 0) {
    dynamicCatalog[existingIdx] = newItem;
  } else {
    dynamicCatalog.push(newItem);
  }

  rebuildSearchIndex();

  if (document.querySelector("#left-panel-body")) {
    renderPaletteUI();
    return document.querySelector<HTMLElement>(`#comp-${newItem.id}`);
  }

  return null;
}

/**
 * Compatibilidad con Fuse.js sobre tarjetas en el DOM (para tests previos si buscan buildComponentSearchIndex)
 */
export function buildComponentSearchIndex(): ComponentSearchItem[] {
  rebuildSearchIndex();
  const cards = document.querySelectorAll<HTMLElement>(".component-card");
  const items: ComponentSearchItem[] = [];

  cards.forEach((card) => {
    items.push({
      element: card,
      id: card.id,
      type: card.dataset.type ?? "",
      name: card.querySelector(".comp-name")?.textContent?.trim() ?? "",
      description: card.querySelector(".comp-desc")?.textContent?.trim() ?? "",
      category: card.closest(".category-group")?.querySelector(".category-header")?.textContent?.trim() ?? "",
      defaultVal: card.dataset.default ?? "",
      tooltip: card.getAttribute("title") ?? "",
      tags: [],
    });
  });

  return items;
}

export function initComponentPaletteController(): void {
  // Si existe el contenedor nuevo #left-panel-body, renderizar UI dinámicamente
  if (document.querySelector("#left-panel-body")) {
    renderPaletteUI();
  } else {
    // Si es un entorno de test con estructura DOM manual previa, enlazar eventos tradicionales
    bindPaletteEvents();
    rebuildSearchIndex();
  }
}

export function getActiveSymbolStandard(): SymbolStandard {
  return activeSymbolStandard;
}
