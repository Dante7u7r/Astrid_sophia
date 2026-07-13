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

export function initComponentPaletteController(): void {
  initComponentCategories();
  initComponentSearch();
}
