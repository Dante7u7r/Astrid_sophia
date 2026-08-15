import type { ParsedSubcircuit } from "../simulation/spice_library_parser";
import { openSpiceImportModal } from "./spice_import_modal";

function getElement<T extends Element>(parent: ParentNode, selector: string): T | null {
  return parent.querySelector<T>(selector);
}

function setCategoryOpen(header: HTMLElement, content: HTMLElement, open: boolean): void {
  content.classList.toggle("open", open);
  header.classList.toggle("active", open);
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

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase().trim();
    const categories = document.querySelectorAll<HTMLElement>(".category-group");

    categories.forEach((group) => {
      const header = getElement<HTMLElement>(group, ".category-header");
      const content = getElement<HTMLElement>(group, ".category-content");
      if (!header || !content) return;

      const cards = content.querySelectorAll<HTMLElement>(".component-card");
      let visibleInGroup = 0;

      cards.forEach((card) => {
        const name = getElement<HTMLElement>(card, ".comp-name")?.textContent?.toLowerCase() ?? "";
        const desc = getElement<HTMLElement>(card, ".comp-desc")?.textContent?.toLowerCase() ?? "";
        const visible = name.includes(query) || desc.includes(query);

        card.style.display = visible ? "flex" : "none";
        if (visible) visibleInGroup++;
      });

      if (query.length > 0) {
        group.style.display = visibleInGroup > 0 ? "block" : "none";
        if (visibleInGroup > 0) setCategoryOpen(header, content, true);
        return;
      }

      group.style.display = "block";
      setCategoryOpen(header, content, header.dataset.category === "pasivos");
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
 * Añade dinámicamente un macromodelo SPICE parseado a la paleta interactiva.
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

  return card;
}

export function initComponentPaletteController(): void {
  initComponentCategories();
  initComponentSearch();
  initSpiceImportTrigger();
}
