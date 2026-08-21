/**
 * FloatingInstrumentManager — Gestor de Ventanas Flotantes Desacoplables (HUD / PIP)
 *
 * Permite desacoplar cualquier instrumento (Osciloscopio, Generador, Lógico, FFT, Trazador I-V)
 * desde el dock inferior o el menú superior hacia ventanas flotantes traslúcidas e independientes.
 *
 * Soporta dos modos:
 * 1. Modo Flotante Libre (Desfijado 🔓): Se mueve por sobre toda la aplicación.
 * 2. Modo Fijado al Lienzo (Pinned 📌): Se ancla a la esquina superior derecha del lienzo y restringe su movimiento al lienzo.
 */

export interface FloatingWindowInfo {
  tabId: string;
  title: string;
  icon: string;
  windowEl: HTMLElement;
  originalParent: HTMLElement;
  originalNextSibling: Node | null;
  contentBox: HTMLElement;
  isPinned: boolean;
}

export class FloatingInstrumentManager {
  private floatingWindows: Map<string, FloatingWindowInfo> = new Map();
  private zIndexCounter = 100;
  private canvasViewport: HTMLElement | null = null;
  private popoutBtn: HTMLButtonElement | null = null;
  private tabNames: Record<string, { title: string; icon: string }> = {
    oscilloscope: { title: "Osciloscopio Digital", icon: "📊" },
    generator: { title: "Generador de Funciones", icon: "⚡" },
    logic: { title: "Analizador Lógico", icon: "⌗" },
    fft: { title: "Espectro FFT", icon: "📈" },
    tracer: { title: "Trazador I-V", icon: "🔬" },
    intelligence: { title: "Asistente IA", icon: "◈" },
  };

  constructor() {
    this.canvasViewport = document.querySelector("#canvas-viewport");
    this.popoutBtn = document.querySelector("#btn-popout-instrument");
    this.init();
  }

  public init(): void {
    if (!this.canvasViewport) {
      this.canvasViewport = document.querySelector("#canvas-viewport");
    }
    if (!this.popoutBtn) {
      this.popoutBtn = document.querySelector("#btn-popout-instrument");
    }

    if (this.popoutBtn) {
      this.popoutBtn.addEventListener("click", () => {
        const activeTabBtn = document.querySelector(".inst-tab.active");
        const activeTabId = activeTabBtn?.getAttribute("data-tab") || "oscilloscope";
        this.popOut(activeTabId);
      });
    }

    const floaterBtn = document.querySelector("#btn-floater-instruments");
    floaterBtn?.addEventListener("click", () => {
      const activeTabBtn = document.querySelector(".inst-tab.active");
      const activeTabId = activeTabBtn?.getAttribute("data-tab") || "oscilloscope";
      if (this.isPoppedOut(activeTabId)) {
        this.popIn(activeTabId);
      } else {
        this.popOut(activeTabId);
      }
    });

    window.addEventListener("open-floating-instrument", (e: Event) => {
      const customEvent = e as CustomEvent<{ tabId: string }>;
      if (customEvent.detail?.tabId) {
        this.popOut(customEvent.detail.tabId);
      }
    });
  }

  public isPoppedOut(tabId: string): boolean {
    return this.floatingWindows.has(tabId);
  }

  public popOut(tabId: string, pinned = false): HTMLElement | null {
    if (this.floatingWindows.has(tabId)) {
      const existing = this.floatingWindows.get(tabId)!;
      this.bringToFront(existing.windowEl);
      return existing.windowEl;
    }

    const contentBox = document.querySelector(`#inst-${tabId}`) as HTMLElement | null;
    if (!contentBox) return null;

    const originalParent = contentBox.parentElement;
    if (!originalParent) return null;

    const originalNextSibling = contentBox.nextSibling;
    const info = this.tabNames[tabId] || { title: tabId, icon: "🛠️" };

    // Crear la estructura de la ventana flotante
    const win = document.createElement("div");
    win.className = "floating-instrument-window active-focus";
    win.id = `floating-win-${tabId}`;
    win.style.zIndex = String(++this.zIndexCounter);
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", info.title);
    win.setAttribute("aria-modal", "false");
    win.tabIndex = -1;

    const windowRecord: FloatingWindowInfo = {
      tabId,
      title: info.title,
      icon: info.icon,
      windowEl: win,
      originalParent,
      originalNextSibling,
      contentBox,
      isPinned: pinned,
    };

    // Cabecera de la ventana
    const header = document.createElement("div");
    header.className = "floating-window-header";

    const titleEl = document.createElement("div");
    titleEl.className = "floating-window-title";
    titleEl.innerHTML = `<span>${info.icon}</span> ${info.title}`;

    const actionsEl = document.createElement("div");
    actionsEl.className = "floating-window-actions";

    // Botón Pin / Fijar en lienzo
    const pinBtn = document.createElement("button");
    pinBtn.className = "floating-window-btn pin-btn";
    pinBtn.type = "button";
    pinBtn.setAttribute("aria-label", windowRecord.isPinned ? "Desfijar de lienzo" : "Fijar al lienzo");
    this.updatePinButton(pinBtn, windowRecord.isPinned);
    pinBtn.addEventListener("click", () => this.togglePin(tabId));

    // Botón Maximizar / Restaurar tamaño
    const maxBtn = document.createElement("button");
    maxBtn.className = "floating-window-btn max-btn";
    maxBtn.type = "button";
    maxBtn.title = "Maximizar / Restaurar ventana";
    maxBtn.setAttribute("aria-label", "Maximizar o restaurar ventana");
    maxBtn.innerHTML = "⛶";
    let isMaximized = false;
    let savedPlacement: { top: string; left: string; width: string; height: string } | null = null;

    maxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isMaximized) {
        savedPlacement = {
          top: win.style.top,
          left: win.style.left,
          width: win.style.width,
          height: win.style.height,
        };
        win.style.top = "8px";
        win.style.left = "8px";
        win.style.width = "calc(100% - 16px)";
        win.style.height = "calc(100% - 16px)";
        win.classList.add("is-maximized");
        maxBtn.innerHTML = "❐";
        isMaximized = true;
      } else {
        if (savedPlacement) {
          win.style.top = savedPlacement.top;
          win.style.left = savedPlacement.left;
          win.style.width = savedPlacement.width;
          win.style.height = savedPlacement.height;
        } else {
          win.style.width = "720px";
          win.style.height = "480px";
        }
        win.classList.remove("is-maximized");
        maxBtn.innerHTML = "⛶";
        isMaximized = false;
      }
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    });

    const popinBtn = document.createElement("button");
    popinBtn.className = "floating-window-btn";
    popinBtn.type = "button";
    popinBtn.title = "Reacoplar al centro de instrumentos";
    popinBtn.setAttribute("aria-label", "Reacoplar instrumento al centro");
    popinBtn.innerHTML = "📥 Reacoplar";
    popinBtn.addEventListener("click", () => this.popIn(tabId));

    const closeBtn = document.createElement("button");
    closeBtn.className = "floating-window-btn";
    closeBtn.type = "button";
    closeBtn.title = "Cerrar ventana flotante";
    closeBtn.setAttribute("aria-label", "Cerrar ventana flotante");
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", () => this.popIn(tabId));

    actionsEl.appendChild(pinBtn);
    actionsEl.appendChild(maxBtn);
    actionsEl.appendChild(popinBtn);
    actionsEl.appendChild(closeBtn);
    header.appendChild(titleEl);
    header.appendChild(actionsEl);

    // Cuerpo de la ventana
    const bodyEl = document.createElement("div");
    bodyEl.className = "floating-window-body";

    // Mover el contenido del instrumento a la ventana flotante
    contentBox.style.display = "flex";
    contentBox.removeAttribute("hidden");
    bodyEl.appendChild(contentBox);

    win.appendChild(header);
    win.appendChild(bodyEl);

    // Atajo de teclado Escape para cerrar/reacoplar ventana activa
    win.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.popIn(tabId);
      }
    });

    // Activar arrastre y elevación al enfocar
    this.makeDraggable(win, header, windowRecord);
    win.addEventListener("mousedown", () => this.bringToFront(win));

    this.floatingWindows.set(tabId, windowRecord);
    this.applyWindowPlacement(windowRecord);

    const savedState = this.loadWindowState(tabId);
    if (savedState) {
      if (savedState.width) win.style.width = savedState.width;
      if (savedState.height) win.style.height = savedState.height;
      if (savedState.top) win.style.top = savedState.top;
      if (savedState.left && savedState.left !== "auto") win.style.left = savedState.left;
      if (savedState.right && savedState.right !== "auto") win.style.right = savedState.right;
    }

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });

    return win;
  }

  public popIn(tabId: string): void {
    const info = this.floatingWindows.get(tabId);
    if (!info) return;

    const { windowEl, originalParent, contentBox } = info;

    // Retornar el contenido del instrumento al storage pool o parent original
    const storagePool = document.querySelector("#instruments-storage-pool") || originalParent;
    if (storagePool) {
      storagePool.appendChild(contentBox);
    }
    contentBox.style.display = "none";
    contentBox.setAttribute("hidden", "true");

    windowEl.remove();
    this.floatingWindows.delete(tabId);

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  public togglePin(tabId: string): void {
    const info = this.floatingWindows.get(tabId);
    if (!info) return;

    info.isPinned = !info.isPinned;
    const pinBtn = info.windowEl.querySelector<HTMLButtonElement>(".pin-btn");
    if (pinBtn) {
      this.updatePinButton(pinBtn, info.isPinned);
    }
    this.applyWindowPlacement(info);
    this.saveWindowState(tabId, info);
  }

  private updatePinButton(btn: HTMLButtonElement, isPinned: boolean): void {
    btn.innerHTML = isPinned ? "📌" : "🔓";
    btn.title = isPinned
      ? "📌 Fijada en el lienzo (Clic para desfijar y mover libremente)"
      : "🔓 Flotante libre (Clic para fijar en lienzo)";
    btn.setAttribute("aria-label", isPinned ? "Desfijar de lienzo" : "Fijar al lienzo");
    btn.classList.toggle("is-pinned", isPinned);
  }

  private applyWindowPlacement(info: FloatingWindowInfo): void {
    const { windowEl, isPinned } = info;
    const targetParent = isPinned && this.canvasViewport
      ? this.canvasViewport
      : (document.querySelector("#app-viewport") || document.body);

    if (windowEl.parentElement !== targetParent) {
      targetParent.appendChild(windowEl);
    }

    if (isPinned) {
      windowEl.classList.add("pinned-to-canvas");
      windowEl.style.top = "12px";
      windowEl.style.right = "12px";
      windowEl.style.left = "auto";
    } else {
      windowEl.classList.remove("pinned-to-canvas");
      const offsetCount = this.floatingWindows.size - 1;
      const topPx = 60 + (offsetCount * 35);
      const leftPx = 80 + (offsetCount * 35);
      windowEl.style.top = `${topPx}px`;
      windowEl.style.left = `${leftPx}px`;
      windowEl.style.right = "auto";
    }
  }

  private saveWindowState(tabId: string, info: FloatingWindowInfo): void {
    try {
      const state = {
        top: info.windowEl.style.top,
        left: info.windowEl.style.left,
        right: info.windowEl.style.right,
        width: info.windowEl.style.width,
        height: info.windowEl.style.height,
        isPinned: info.isPinned,
      };
      localStorage.setItem(`astryd_flt_win_${tabId}`, JSON.stringify(state));
    } catch {
      // Ignorar errores de storage
    }
  }

  private loadWindowState(tabId: string): {
    top: string;
    left: string;
    right: string;
    width: string;
    height: string;
    isPinned: boolean;
  } | null {
    try {
      const raw = localStorage.getItem(`astryd_flt_win_${tabId}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private bringToFront(win: HTMLElement): void {
    this.floatingWindows.forEach(({ windowEl }) => {
      windowEl.classList.remove("active-focus");
    });
    win.classList.add("active-focus");
    win.style.zIndex = String(++this.zIndexCounter);
  }

  private makeDraggable(windowEl: HTMLElement, handleEl: HTMLElement, info: FloatingWindowInfo): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".floating-window-actions")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = windowEl.offsetLeft;
      initialTop = windowEl.offsetTop;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (info.isPinned && this.canvasViewport) {
        const vpRect = this.canvasViewport.getBoundingClientRect();
        const winRect = windowEl.getBoundingClientRect();
        const maxLeft = Math.max(0, vpRect.width - winRect.width);
        const maxTop = Math.max(0, vpRect.height - winRect.height);

        const newLeft = Math.max(0, Math.min(initialLeft + dx, maxLeft));
        const newTop = Math.max(0, Math.min(initialTop + dy, maxTop));
        windowEl.style.left = `${newLeft}px`;
        windowEl.style.top = `${newTop}px`;
        windowEl.style.right = "auto";
      } else {
        windowEl.style.left = `${Math.max(0, initialLeft + dx)}px`;
        windowEl.style.top = `${Math.max(0, initialTop + dy)}px`;
        windowEl.style.right = "auto";
      }
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        this.saveWindowState(info.tabId, info);
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handleEl.addEventListener("mousedown", onMouseDown);
  }
}
