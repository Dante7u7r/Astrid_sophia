import type { OscilloscopePanel } from "./oscilloscope_panel";

/**
 * oscilloscope_context_menu.ts — Menú Contextual de Clic Derecho para el Osciloscopio Digital.
 *
 * Provee accesos rápidos a calibración de disparo, centrado a 0V,
 * reubicación de cursores de medición en coordenadas del clic y exportaciones.
 */

export function showOscilloscopeContextMenu(
  event: MouseEvent,
  panel: OscilloscopePanel,
): void {
  event.preventDefault();

  const canvas = event.currentTarget as HTMLCanvasElement | null;
  if (!canvas) return;

  const existingMenu = document.getElementById("osc-context-menu");
  if (existingMenu) existingMenu.remove();

  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  const w = rect.width;
  const h = rect.height;
  if (w <= 0 || h <= 0) return;

  const divHeight = h / 8;
  const centerY = h / 2;

  // Voltaje en el punto del clic según el canal de disparo
  const trigVPerDiv = panel.getVoltsPerDiv(panel.triggerChannel) || 1.0;
  const voltsAtClick = ((centerY - clickY) / divHeight) * trigVPerDiv;
  const voltsStr = `${voltsAtClick >= 0 ? "+" : ""}${voltsAtClick.toFixed(2)} V`;

  // Fracción de tiempo horizontal
  const fractionX = Math.max(0.01, Math.min(0.99, clickX / w));

  const menu = document.createElement("div");
  menu.id = "osc-context-menu";
  menu.className = "canvas-context-menu osc-context-menu";

  const container = canvas.parentElement || document.body;
  const containerRect = container.getBoundingClientRect();
  const posX = event.clientX - containerRect.left + container.scrollLeft;
  const posY = event.clientY - containerRect.top + container.scrollTop;

  menu.style.position = "absolute";
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  const closeMenu = (evt: MouseEvent) => {
    if (!menu.contains(evt.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    }
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
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

    btn.addEventListener("click", () => {
      action();
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    });

    return btn;
  };

  const appendDivider = () => {
    const divider = document.createElement("div");
    divider.className = "context-menu-divider";
    menu.appendChild(divider);
  };

  // 1. Opciones de Disparo
  menu.appendChild(
    createMenuItem(`Fijar Disparo aquí (${voltsStr})`, "", () => {
      panel.triggerLevel = voltsAtClick;
      panel.syncFocusedChannelUI();
      panel.updateHud();
      panel.draw();
    }, "🎯"),
  );

  menu.appendChild(
    createMenuItem("Centrar Disparo en 0V", "", () => {
      panel.setTriggerLevelZero();
    }, "⚡"),
  );

  menu.appendChild(
    createMenuItem("Disparo al 50% de la Señal", "", () => {
      panel.setTriggerTo50Percent();
    }, "⚡"),
  );

  appendDivider();

  // 2. Opciones de Canal Enfocado y Ajuste
  const focusedLabel = panel.focusedChannel.toUpperCase();
  menu.appendChild(
    createMenuItem(`Centrar Offset ${focusedLabel} en 0V`, "", () => {
      panel.setFocusedOffsetZero();
    }, "⚡"),
  );

  menu.appendChild(
    createMenuItem("Auto-Ajuste (Auto-Set)", "", () => {
      panel.autoFit();
    }, "✨"),
  );

  menu.appendChild(
    createMenuItem(
      panel.isAutoRangeEnabled ? "Desactivar Auto-Range Continuo" : "Activar Auto-Range Continuo",
      "",
      () => {
        panel.isAutoRangeEnabled = !panel.isAutoRangeEnabled;
        panel.updateAutoRangeButtonState();
        if (panel.isAutoRangeEnabled) {
          panel.runAutoRangeCheck(true);
        }
        panel.draw();
      },
      "🔄",
    ),
  );

  appendDivider();

  // 3. Opciones de Cursores
  menu.appendChild(
    createMenuItem("Mover Cursor de Tiempo aquí (X)", "", () => {
      panel.moveNearestCursorT(fractionX);
    }, "📏"),
  );

  menu.appendChild(
    createMenuItem(`Mover Cursor de Voltaje aquí (${voltsStr})`, "", () => {
      panel.moveNearestCursorV(voltsAtClick);
    }, "📏"),
  );

  menu.appendChild(
    createMenuItem(
      panel.isCursorsEnabled ? "Desactivar Cursores" : "Activar Cursores (Ambos)",
      "",
      () => {
        panel.setCursorMode(panel.isCursorsEnabled ? "off" : "both");
      },
      "📐",
    ),
  );

  appendDivider();

  // 4. Captura y Exportación
  menu.appendChild(
    createMenuItem("Captura PNG de Pantalla", "", () => {
      panel.snapshotPng();
    }, "📸"),
  );

  menu.appendChild(
    createMenuItem("Exportar Datos CSV", "", () => {
      panel.exportCsv();
    }, "💾"),
  );

  container.appendChild(menu);

  // Ajuste inteligente para evitar desbordamiento
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 10) {
    menu.style.left = `${Math.max(10, posX - menuRect.width)}px`;
  }
  if (menuRect.bottom > window.innerHeight - 10) {
    menu.style.top = `${Math.max(10, posY - menuRect.height)}px`;
  }
}
