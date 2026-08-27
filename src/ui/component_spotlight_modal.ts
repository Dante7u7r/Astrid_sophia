// ==========================================================================
// COMPONENT SPOTLIGHT MODAL — Inserción rápida EDA vía teclado (Ctrl+K / /)
// ==========================================================================

import Fuse, { type IFuseOptions } from "fuse.js";
import {
  COMPONENT_CATALOG,
  type EnhancedCatalogItem,
  type SymbolStandard,
} from "../components/component_catalog_model";

export interface SpotlightSelectCallback {
  (item: EnhancedCatalogItem): void;
}

let activeSpotlightContainer: HTMLElement | null = null;

export class ComponentSpotlightModal {
  private static fuseInstance: Fuse<EnhancedCatalogItem> | null = null;

  private static getFuse(): Fuse<EnhancedCatalogItem> {
    if (!ComponentSpotlightModal.fuseInstance) {
      const options: IFuseOptions<EnhancedCatalogItem> = {
        keys: [
          { name: "shortName", weight: 0.4 },
          { name: "name", weight: 0.35 },
          { name: "hotkey", weight: 0.15 },
          { name: "tags", weight: 0.1 },
          { name: "description", weight: 0.05 },
        ],
        threshold: 0.3,
        distance: 100,
        minMatchCharLength: 1,
        includeScore: true,
        shouldSort: true,
      };
      ComponentSpotlightModal.fuseInstance = new Fuse(COMPONENT_CATALOG as EnhancedCatalogItem[], options);
    }
    return ComponentSpotlightModal.fuseInstance;
  }

  public static close(): void {
    if (activeSpotlightContainer) {
      activeSpotlightContainer.classList.remove("open");
      activeSpotlightContainer.remove();
      activeSpotlightContainer = null;
    }
  }

  public static isOpen(): boolean {
    return activeSpotlightContainer !== null;
  }

  public static open(onSelect: SpotlightSelectCallback, standard: SymbolStandard = "IEEE"): void {
    ComponentSpotlightModal.close();

    const backdrop = document.createElement("div");
    backdrop.id = "spotlight-modal-backdrop";
    backdrop.className = "spotlight-modal-backdrop open";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Búsqueda rápida de componentes EDA");

    backdrop.innerHTML = `
      <div class="spotlight-dialog">
        <div class="spotlight-header spotlight-search-bar">
          <span class="spotlight-search-icon">🔍</span>
          <input type="text" id="spotlight-search-input" class="spotlight-input spotlight-search-input" placeholder="Buscar componente o valor (ej: R 4.7k, Diodo, GND, 7408)..." autocomplete="off" spellcheck="false" />
          <kbd class="spotlight-esc-hint spotlight-search-esc">ESC</kbd>
        </div>
        <div class="spotlight-body">
          <ul class="spotlight-results" id="spotlight-results" role="listbox" aria-label="Resultados de componentes"></ul>
          <aside class="spotlight-preview spotlight-preview-pane" id="spotlight-preview" aria-live="polite">
            <div class="spotlight-preview-empty">Selecciona un componente para ver su ficha física y modelo SPICE</div>
          </aside>
        </div>
        <div class="spotlight-footer">
          <div class="spotlight-footer-shortcuts">
            <span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
            <span><kbd>↵</kbd> Colocar en cursor</span>
            <span><kbd>ESC</kbd> Cerrar</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    activeSpotlightContainer = backdrop;

    const input = backdrop.querySelector<HTMLInputElement>("#spotlight-search-input");
    const resultsList = backdrop.querySelector<HTMLUListElement>("#spotlight-results");
    const previewBox = backdrop.querySelector<HTMLElement>("#spotlight-preview");

    if (!input || !resultsList || !previewBox) return;

    input.focus();

    let currentResults: EnhancedCatalogItem[] = [...COMPONENT_CATALOG];
    let selectedIndex = 0;

    const updatePreview = (item: EnhancedCatalogItem | undefined) => {
      if (!item) {
        previewBox.innerHTML = `<div class="spotlight-preview-empty">No hay componente seleccionado</div>`;
        return;
      }

      const svgSymbol = standard === "IEC" ? item.svgIconIec : item.svgIconIeee;
      const equationHtml = item.physicsEquation ? `<div class="spotlight-preview-eq spotlight-preview-equation"><code>${item.physicsEquation}</code></div>` : "";
      const spiceBadge = item.spiceModelLevel ? `<div class="spotlight-preview-spice">🔬 <strong>SPICE:</strong> ${item.spiceModelLevel}</div>` : "";

      previewBox.innerHTML = `
        <div class="spotlight-preview-header">
          <div class="spotlight-preview-icon">
            <svg viewBox="0 0 40 40" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              ${svgSymbol}
            </svg>
          </div>
          <div class="spotlight-preview-heading">
            <h4 class="spotlight-preview-title">${item.name}</h4>
            <span class="spotlight-preview-badge">${item.categoryLabel} · ${item.unit || "—"}</span>
          </div>
        </div>
        <p class="spotlight-preview-desc spotlight-preview-details">${item.academicSummary || item.description}</p>
        ${equationHtml}
        ${spiceBadge}
      `;
    };

    const renderList = () => {
      resultsList.innerHTML = "";
      if (currentResults.length === 0) {
        resultsList.innerHTML = `<li class="spotlight-no-results">Sin coincidencias para la búsqueda.</li>`;
        updatePreview(undefined);
        return;
      }

      currentResults.forEach((item, idx) => {
        const isSelected = idx === selectedIndex;
        const li = document.createElement("li");
        li.className = `spotlight-item ${isSelected ? "selected" : ""}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(isSelected));

        const hotkeyBadge = item.hotkey ? `<kbd class="spotlight-item-badge spotlight-item-hotkey">${item.hotkey}</kbd>` : "";
        const svgSymbol = standard === "IEC" ? item.svgIconIec : item.svgIconIeee;

        li.innerHTML = `
          <div class="spotlight-item-left">
            <div class="spotlight-item-icon">
              <svg viewBox="0 0 40 40" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                ${svgSymbol}
              </svg>
            </div>
            <div class="spotlight-item-info spotlight-item-text">
              <span class="spotlight-item-name">${item.name}</span>
              <span class="spotlight-item-desc spotlight-item-cat">${item.categoryLabel}</span>
            </div>
          </div>
          <div class="spotlight-item-right">
            ${hotkeyBadge}
            <span class="spotlight-item-val">${item.defaultVal}${item.unit ? ` ${item.unit}` : ""}</span>
          </div>
        `;

        li.addEventListener("click", () => {
          ComponentSpotlightModal.close();
          onSelect(item);
        });

        li.addEventListener("mouseenter", () => {
          selectedIndex = idx;
          updateActiveSelection();
        });

        resultsList.appendChild(li);
      });

      updateActiveSelection();
    };

    const updateActiveSelection = () => {
      const items = resultsList.querySelectorAll<HTMLElement>(".spotlight-item");
      items.forEach((it, i) => {
        const isSel = i === selectedIndex;
        it.classList.toggle("selected", isSel);
        it.setAttribute("aria-selected", String(isSel));
        if (isSel) {
          it.scrollIntoView({ block: "nearest" });
        }
      });
      updatePreview(currentResults[selectedIndex]);
    };

    const handleSearch = () => {
      const q = input.value.trim();
      if (!q) {
        currentResults = [...COMPONENT_CATALOG];
      } else {
        const lower = q.toLowerCase();
        const fuse = ComponentSpotlightModal.getFuse();
        const res = fuse.search(q);
        currentResults = res.map((r) => r.item);

        // Fallback directo por substring
        if (currentResults.length === 0) {
          currentResults = COMPONENT_CATALOG.filter(
            (c) =>
              c.name.toLowerCase().includes(lower) ||
              c.shortName.toLowerCase().includes(lower) ||
              c.tags.some((t) => t.includes(lower)),
          );
        }

        // Priorizar coincidencia exacta de id, type, alias o shortName
        const exactIdx = currentResults.findIndex(
          (c) =>
            c.id.toLowerCase() === lower ||
            c.type.toLowerCase() === lower ||
            (lower === "diodo" && c.type === "diode") ||
            (lower === "diode" && c.type === "diode") ||
            c.shortName.toLowerCase() === lower,
        );
        if (exactIdx > 0) {
          const [matched] = currentResults.splice(exactIdx, 1);
          currentResults.unshift(matched);
        }
      }
      selectedIndex = 0;
      renderList();
    };

    input.addEventListener("input", handleSearch);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ComponentSpotlightModal.close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentResults.length > 0) {
          selectedIndex = (selectedIndex + 1) % currentResults.length;
          updateActiveSelection();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentResults.length > 0) {
          selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
          updateActiveSelection();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = currentResults[selectedIndex];
        if (selected) {
          ComponentSpotlightModal.close();
          onSelect(selected);
        }
      }
    };

    backdrop.addEventListener("keydown", onKeyDown);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        ComponentSpotlightModal.close();
      }
    });

    renderList();
  }
}
