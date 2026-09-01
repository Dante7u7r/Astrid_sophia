/**
 * floating_instrument_context_menu.ts — Menú Contextual CAD para Ventanas Flotantes de Instrumentos
 *
 * Provee un menú contextual nativo de ingeniería (con soporte para tema Oscuro y Aula)
 * al hacer clic derecho en cualquier parte de una ventana flotante (cabecera, controles laterales, fondo),
 * eliminando por completo el menú web genérico del navegador.
 */

import type { FloatingInstrumentManager, FloatingWindowInfo } from "./floating_instrument_manager";

export function showFloatingInstrumentContextMenu(
  event: MouseEvent,
  tabId: string,
  manager: FloatingInstrumentManager,
  windowInfo: FloatingWindowInfo,
): void {
  event.preventDefault();
  event.stopPropagation();

  // Cerrar cualquier menú contextual existente
  const existingMenu = document.getElementById("floating-inst-context-menu");
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement("div");
  menu.id = "floating-inst-context-menu";
  menu.className = "canvas-context-menu floating-inst-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Opciones de ${windowInfo.title}`);

  // Posicionamiento flotante en coordenadas de pantalla
  menu.style.position = "fixed";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.zIndex = "100000";

  const closeMenu = (evt?: MouseEvent | KeyboardEvent) => {
    if (evt && evt instanceof MouseEvent && menu.contains(evt.target as Node)) {
      return;
    }
    menu.remove();
    document.removeEventListener("mousedown", closeMenu);
    document.removeEventListener("keydown", onKeyDown);
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      closeMenu();
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", onKeyDown);
  }, 10);

  const createMenuItem = (
    label: string,
    shortcut: string,
    action: () => void,
    icon = "",
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.type = "button";
    btn.setAttribute("role", "menuitem");

    const leftDiv = document.createElement("div");
    leftDiv.className = "context-menu-item-left";

    if (icon) {
      const iconSpan = document.createElement("span");
      iconSpan.className = "context-menu-icon";
      iconSpan.textContent = icon;
      leftDiv.appendChild(iconSpan);
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    leftDiv.appendChild(labelSpan);
    btn.appendChild(leftDiv);

    if (shortcut) {
      const shortcutSpan = document.createElement("span");
      shortcutSpan.className = "context-menu-shortcut";
      shortcutSpan.textContent = shortcut;
      btn.appendChild(shortcutSpan);
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
      action();
    });

    return btn;
  };

  const createDivider = (): HTMLDivElement => {
    const div = document.createElement("div");
    div.className = "context-menu-divider";
    return div;
  };

  // 1. Acciones Generales de Ventana Flotante
  const isPinned = windowInfo.isPinned;
  menu.appendChild(
    createMenuItem(
      isPinned ? "Desfijar de Lienzo (Modo Libre)" : "Fijar al Lienzo (Modo PIP)",
      "P",
      () => manager.togglePin(tabId),
      isPinned ? "🔓" : "📌",
    ),
  );

  menu.appendChild(
    createMenuItem(
      "Maximizar / Restaurar Tamaño",
      "M",
      () => {
        const maxBtn = windowInfo.windowEl.querySelector<HTMLButtonElement>(".max-btn");
        maxBtn?.click();
      },
      "⛶",
    ),
  );

  menu.appendChild(
    createMenuItem(
      "Reacoplar al Dock Inferior",
      "R",
      () => manager.popIn(tabId),
      "📥",
    ),
  );

  menu.appendChild(createDivider());

  // 2. Acciones Específicas según el Instrumento
  if (tabId === "oscilloscope") {
    menu.appendChild(
      createMenuItem(
        "Auto-Set de Escala",
        "A",
        () => {
          const autoBtn = document.querySelector<HTMLButtonElement>("#osc-btn-autoset, #btn-osc-autoset");
          autoBtn?.click();
        },
        "🎯",
      ),
    );

    menu.appendChild(
      createMenuItem(
        "Alternar Cursores de Medición",
        "C",
        () => {
          const cursorsBtn = document.querySelector<HTMLButtonElement>("#osc-btn-cursors, #btn-osc-cursors");
          cursorsBtn?.click();
        },
        "📐",
      ),
    );

    menu.appendChild(
      createMenuItem(
        "Capturar Pantalla (PNG)",
        "Ctrl+S",
        () => {
          const pngBtn = document.querySelector<HTMLButtonElement>("#osc-btn-export-png, #btn-osc-png");
          pngBtn?.click();
        },
        "📸",
      ),
    );

    menu.appendChild(
      createMenuItem(
        "Exportar Trazas a CSV",
        "Ctrl+E",
        () => {
          const csvBtn = document.querySelector<HTMLButtonElement>("#osc-btn-export-csv, #btn-osc-csv");
          csvBtn?.click();
        },
        "💾",
      ),
    );

    menu.appendChild(createDivider());
  } else if (tabId === "generator") {
    menu.appendChild(
      createMenuItem(
        "Capturar Imagen de Señal (PNG)",
        "",
        () => {
          const pngBtn = document.querySelector<HTMLButtonElement>("#gen-btn-export-png, #btn-gen-png");
          pngBtn?.click();
        },
        "📸",
      ),
    );
    menu.appendChild(createDivider());
  } else if (tabId === "logic") {
    menu.appendChild(
      createMenuItem(
        "Capturar Analizador Lógico (PNG)",
        "",
        () => {
          const pngBtn = document.querySelector<HTMLButtonElement>("#logic-btn-export-png, #btn-logic-png");
          pngBtn?.click();
        },
        "📸",
      ),
    );
    menu.appendChild(createDivider());
  } else if (tabId === "fft") {
    menu.appendChild(
      createMenuItem(
        "Capturar Espectro FFT (PNG)",
        "",
        () => {
          const pngBtn = document.querySelector<HTMLButtonElement>("#fft-btn-export-png, #btn-fft-png");
          pngBtn?.click();
        },
        "📸",
      ),
    );
    menu.appendChild(createDivider());
  } else if (tabId === "tracer") {
    menu.appendChild(
      createMenuItem(
        "Capturar Curva Característica (PNG)",
        "",
        () => {
          const pngBtn = document.querySelector<HTMLButtonElement>("#tracer-btn-export-png, #btn-tracer-png");
          pngBtn?.click();
        },
        "📸",
      ),
    );
    menu.appendChild(createDivider());
  }

  // 3. Opción de Cierre
  menu.appendChild(
    createMenuItem(
      "Cerrar Ventana",
      "Esc",
      () => manager.popIn(tabId),
      "✕",
    ),
  );

  document.body.appendChild(menu);

  // Asegurar que el menú no quede fuera de los límites de la ventana del navegador
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - menuRect.width - 8)}px`;
  }
  if (menuRect.bottom > window.innerHeight - 8) {
    menu.style.top = `${Math.max(8, window.innerHeight - menuRect.height - 8)}px`;
  }
}
