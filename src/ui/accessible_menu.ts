export class AccessibleMenu {
  private readonly items: HTMLButtonElement[];
  private isOpen = false;

  constructor(
    private readonly trigger: HTMLButtonElement,
    private readonly menu: HTMLElement,
  ) {
    this.items = [...menu.querySelectorAll<HTMLButtonElement>(".dropdown-menu-item-btn")];
    this.items.forEach((item) => item.setAttribute("role", "menuitem"));
    this.trigger.setAttribute("aria-haspopup", "menu");
    this.trigger.setAttribute("aria-controls", menu.id);
    this.trigger.setAttribute("aria-expanded", "false");
    this.menu.setAttribute("role", "menu");
    this.menu.hidden = true;
    this.menu.style.display = "none";

    this.trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle(false);
    });
    this.trigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.open(event.key === "ArrowUp" ? this.items.length - 1 : 0);
    });
    this.menu.addEventListener("keydown", (event) => this.handleMenuKey(event));
    this.menu.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
        this.close(false);
      }
    });
    document.addEventListener("click", (event) => {
      if (!this.menu.contains(event.target as Node) && event.target !== this.trigger) {
        this.close(false);
      }
    });
  }

  public open(focusIndex?: number): void {
    this.isOpen = true;
    this.menu.hidden = false;
    this.menu.style.display = "block";
    this.trigger.setAttribute("aria-expanded", "true");
    if (focusIndex !== undefined && this.items.length > 0) {
      this.items[Math.max(0, Math.min(focusIndex, this.items.length - 1))].focus();
    }
  }

  public close(returnFocus = false): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.hidden = true;
    this.menu.style.display = "none";
    this.trigger.setAttribute("aria-expanded", "false");
    const instrumentCenter = document.querySelector("#bottom-dock");
    const instrumentCenterClose = document.querySelector("#instrument-center-close") as HTMLButtonElement | null;
    if (
      !returnFocus
      && instrumentCenter instanceof HTMLElement
      && !instrumentCenter.classList.contains("collapsed")
      && instrumentCenterClose
    ) {
      instrumentCenterClose.focus({ preventScroll: true });
      return;
    }
    if (returnFocus) this.trigger.focus();
  }

  public toggle(focusFirst: boolean): void {
    if (this.isOpen) {
      this.close(false);
    } else {
      this.open(focusFirst ? 0 : undefined);
    }
  }

  private handleMenuKey(event: KeyboardEvent): void {
    if (this.items.length === 0) return;
    const activeIndex = this.items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = activeIndex;
    if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % this.items.length;
    else if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + this.items.length) % this.items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = this.items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
      return;
    } else if (event.key === "Tab") {
      this.close(false);
      return;
    } else {
      return;
    }

    event.preventDefault();
    this.items[nextIndex].focus();
  }
}
