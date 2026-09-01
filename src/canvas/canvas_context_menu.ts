import {
  type CanvasOrchestrator,
  type ComponentInstance,
  type WireInstance,
  hitTestComponentAt,
} from "../canvas_orchestrator";
import type { CanvasInputCallbacks } from "./canvas_input_controller";
import { clientToCanvasPoint } from "./canvas_input_model";

export type ContextMenuCallbacks = Pick<
  CanvasInputCallbacks,
  | "requestRender"
  | "onCanvasModified"
  | "onNetlistSync"
  | "onSelectionChanged"
  | "onSelectAll"
  | "onWireMode"
  | "onProbePlaced"
  | "getPinNode"
  | "onFitAll"
  | "log"
  | "onUndo"
  | "onRedo"
>;

export type SelectionGridAlignment = "horizontal-center" | "vertical-center" | "snap";

interface AlignableComponent {
  x: number;
  y: number;
}

export function alignSelectionToGrid(
  components: readonly AlignableComponent[],
  gridSize: number,
  alignment: SelectionGridAlignment,
): void {
  if (components.length === 0) return;
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    throw new RangeError("gridSize debe ser un número finito mayor que cero");
  }

  const snap = (coordinate: number): number => Math.round(coordinate / gridSize) * gridSize;
  if (alignment === "horizontal-center") {
    const averageY = components.reduce((sum, component) => sum + component.y, 0) / components.length;
    const alignedY = snap(averageY);
    components.forEach((component) => { component.y = alignedY; });
    return;
  }
  if (alignment === "vertical-center") {
    const averageX = components.reduce((sum, component) => sum + component.x, 0) / components.length;
    const alignedX = snap(averageX);
    components.forEach((component) => { component.x = alignedX; });
    return;
  }

  components.forEach((component) => {
    component.x = snap(component.x);
    component.y = snap(component.y);
  });
}

export function showCanvasContextMenu(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
): void {
  event.preventDefault();

  const existingMenu = document.getElementById("canvas-context-menu");
  if (existingMenu) existingMenu.remove();

  const rect = canvas.getBoundingClientRect();
  const { screenX, screenY } = clientToCanvasPoint(rect, event);
  const worldPt = orchestrator.screenToWorld(screenX, screenY);

  const clickedComp = orchestrator.components.find(
    comp => hitTestComponentAt(comp, worldPt.x, worldPt.y),
  );
  const clickedWire = clickedComp ? null : (orchestrator.hoveredWire || orchestrator.selectedWire);

  const menu = document.createElement("div");
  menu.id = "canvas-context-menu";
  menu.className = "canvas-context-menu";

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
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", closeMenu);
  }, 10);

  const createMenuItem = (
    label: string,
    shortcut: string,
    action: () => void,
    icon = "",
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";

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
    });
    return btn;
  };

  const createSubmenu = (
    label: string,
    icon = "",
  ): { wrapper: HTMLElement; submenu: HTMLElement } => {
    const wrapper = document.createElement("div");
    wrapper.className = "context-menu-item-wrapper";

    const triggerBtn = document.createElement("button");
    triggerBtn.className = "context-menu-item";
    triggerBtn.type = "button";

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
    triggerBtn.appendChild(leftDiv);

    const arrowSpan = document.createElement("span");
    arrowSpan.className = "context-menu-arrow";
    arrowSpan.textContent = "▶";
    triggerBtn.appendChild(arrowSpan);

    const submenu = document.createElement("div");
    submenu.className = "context-menu-submenu";

    wrapper.appendChild(triggerBtn);
    wrapper.appendChild(submenu);

    wrapper.addEventListener("mouseenter", () => {
      const subRect = submenu.getBoundingClientRect();
      if (subRect.right > window.innerWidth) {
        submenu.classList.add("flip-x");
      }
      if (subRect.bottom > window.innerHeight) {
        submenu.classList.add("flip-y");
      }
    });

    return { wrapper, submenu };
  };

  if (clickedComp) {
    populateComponentMenu(menu, clickedComp, orchestrator, callbacks, createMenuItem, createSubmenu);
  } else if (clickedWire) {
    populateWireMenu(menu, clickedWire, orchestrator, callbacks, createMenuItem, createSubmenu);
  } else {
    populateCanvasMenu(menu, worldPt, orchestrator, callbacks, createMenuItem, createSubmenu);
  }

  container.appendChild(menu);

  // Ajuste inteligente de límites para el menú principal
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 10) {
    menu.style.left = `${Math.max(10, posX - menuRect.width)}px`;
  }
  if (menuRect.bottom > window.innerHeight - 10) {
    menu.style.top = `${Math.max(10, posY - menuRect.height)}px`;
  }
}

function appendDivider(menu: HTMLElement): void {
  const divider = document.createElement("div");
  divider.className = "context-menu-divider";
  menu.appendChild(divider);
}

function populateComponentMenu(
  menu: HTMLElement,
  clickedComp: ComponentInstance,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
  createMenuItem: (label: string, shortcut: string, action: () => void, icon?: string) => HTMLButtonElement,
  createSubmenu: (label: string, icon?: string) => { wrapper: HTMLElement; submenu: HTMLElement },
): void {
  const isSelected = clickedComp.selected
    || orchestrator.selectedComponent?.id === clickedComp.id
    || orchestrator.selectedComponents.some(c => c.id === clickedComp.id);

  if (!isSelected) {
    orchestrator.selectedComponent = clickedComp;
    orchestrator.selectedComponents = [];
    callbacks.onSelectionChanged(clickedComp);
    callbacks.requestRender(true);
  }

  menu.appendChild(createMenuItem("Propiedades...", "", () => {
    callbacks.onSelectionChanged(clickedComp);
    const propPanel = document.querySelector("#property-editor");
    if (propPanel) propPanel.classList.remove("collapsed");
  }, "⚙️"));

  if (clickedComp.value !== undefined && clickedComp.value !== null && clickedComp.type !== "ground") {
    const valDisplay = String(clickedComp.value);
    menu.appendChild(createMenuItem(`Editar Valor (${valDisplay})...`, "F2", () => {
      const newVal = window.prompt(`Introduce el nuevo valor para [${clickedComp.id}]:`, valDisplay);
      if (newVal !== null && newVal.trim() !== "") {
        const trimmed = newVal.trim();
        clickedComp.value = trimmed;
        callbacks.onSelectionChanged(clickedComp);
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        callbacks.onNetlistSync();
        callbacks.log(`Valor de [${clickedComp.id}] actualizado a "${trimmed}"`, "system");
      }
    }, "✏️"));
  }

  menu.appendChild(createMenuItem("Rotar 90°", "R", () => {
    orchestrator.rotateSelectedComponent();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }, "🔄"));

  menu.appendChild(createMenuItem("Rotar 15° Fino", "Shift+Rueda", () => {
    orchestrator.rotateSelectedByDegrees(15);
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }, "📐"));

  menu.appendChild(createMenuItem("Espejo Horizontal (Flip H)", "M", () => {
    orchestrator.mirrorSelectedComponent();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "🪞"));

  menu.appendChild(createMenuItem("Espejo Vertical (Flip V)", "Shift+M", () => {
    orchestrator.mirrorSelectedComponentVertical();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "↕️"));

  menu.appendChild(createMenuItem("Copiar", "Ctrl+C", () => {
    const count = orchestrator.copySelected();
    if (count > 0) {
      callbacks.log(
        count === 1
          ? "Componente copiado al portapapeles."
          : `Lote de ${count} elementos copiado al portapapeles.`,
        "system",
      );
    }
  }, "📋"));

  menu.appendChild(createMenuItem("Cortar", "Ctrl+X", () => {
    const count = orchestrator.cutSelected();
    if (count > 0) {
      callbacks.onSelectionChanged(null);
      callbacks.onNetlistSync();
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
      callbacks.log(
        count === 1
          ? "Componente cortado al portapapeles."
          : `Lote de ${count} elementos cortado al portapapeles.`,
        "system",
      );
    }
  }, "✂️"));

  menu.appendChild(createMenuItem("Duplicar", "Ctrl+D", () => {
    orchestrator.duplicateSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "📑"));

  // Submenú Sondas
  const { wrapper: probeWrapper, submenu: probeSubmenu } = createSubmenu("Colocar Sonda Osciloscopio", "📍");
  const probeConfigs = [
    { ch: "CH1" as const, label: "Canal 1 (CH1 - Amarillo)", icon: "🟡", pinIdx: 0, defaultNode: "1" },
    { ch: "CH2" as const, label: "Canal 2 (CH2 - Celeste)", icon: "🔵", pinIdx: 0, defaultNode: "2" },
    { ch: "CH3" as const, label: "Canal 3 (CH3 - Rosa)", icon: "🔴", pinIdx: 0, defaultNode: "3" },
    { ch: "CH4" as const, label: "Canal 4 (CH4 - Verde)", icon: "🟢", pinIdx: 0, defaultNode: "4" },
  ];
  for (const p of probeConfigs) {
    probeSubmenu.appendChild(createMenuItem(p.label, "", () => {
      const pinKey = `${clickedComp.id}:${p.pinIdx}`;
      const nodeId = callbacks.getPinNode(pinKey) ?? p.defaultNode;
      callbacks.onProbePlaced(p.ch, nodeId);
      callbacks.log(`Sonda ${p.ch} conectada a [${clickedComp.id}] (Nodo: ${nodeId})`, "system");
    }, p.icon));
  }
  menu.appendChild(probeWrapper);

  // Submenú Conversión de Tipo de Terminal (si es net_label)
  if (clickedComp.type === "net_label") {
    const { wrapper: terminalWrapper, submenu: terminalSubmenu } = createSubmenu("Convertir Puerto / Terminal", "⚡");
    const terminalOptions: { label: string; icon: string; action: () => void }[] = [
      {
        label: "Puerto de Señal (Net Label)",
        icon: "🔷",
        action: () => {
          clickedComp.terminalType = "signal";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Puerto de Entrada (Input)",
        icon: "📥",
        action: () => {
          clickedComp.terminalType = "input";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Puerto de Salida (Output)",
        icon: "📤",
        action: () => {
          clickedComp.terminalType = "output";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Puerto Bidireccional (In/Out)",
        icon: "↔️",
        action: () => {
          clickedComp.terminalType = "bidirectional";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Puerto de Bus (Bus [N:0])",
        icon: "🚍",
        action: () => {
          clickedComp.terminalType = "bus_tap";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Terminal VCC (+5V)",
        icon: "⚡",
        action: () => {
          clickedComp.terminalType = "power";
          clickedComp.voltage = 5.0;
          clickedComp.label = "+5V";
          clickedComp.value = "+5V";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Terminal VDD (+3.3V)",
        icon: "⚡",
        action: () => {
          clickedComp.terminalType = "power";
          clickedComp.voltage = 3.3;
          clickedComp.label = "+3.3V";
          clickedComp.value = "+3.3V";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Terminal Tierra (GND / 0V)",
        icon: "⏚",
        action: () => {
          clickedComp.terminalType = "ground";
          clickedComp.terminalStyle = "standard";
          clickedComp.label = "GND";
          clickedComp.value = "GND";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Tierra Analógica (AGND)",
        icon: "⏚",
        action: () => {
          clickedComp.terminalType = "ground";
          clickedComp.terminalStyle = "analog";
          clickedComp.label = "AGND";
          clickedComp.value = "AGND";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Punto de Prueba (Test Point TP)",
        icon: "⦿",
        action: () => {
          clickedComp.terminalType = "test_point";
          if (!clickedComp.label || clickedComp.label === "NET" || clickedComp.label === "GND") {
            clickedComp.label = "TP1";
            clickedComp.value = "TP1";
          }
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
      {
        label: "Sin Conexión (NC ✕)",
        icon: "✕",
        action: () => {
          clickedComp.terminalType = "no_connect";
          clickedComp.label = "NC";
          clickedComp.value = "NC";
          callbacks.requestRender(true);
          callbacks.onCanvasModified();
          callbacks.onNetlistSync();
        },
      },
    ];
    for (const opt of terminalOptions) {
      terminalSubmenu.appendChild(createMenuItem(opt.label, "", opt.action, opt.icon));
    }
    menu.appendChild(terminalWrapper);
  }

  // Submenú Alineación (si hay selección múltiple)
  if (orchestrator.selectedComponents.length > 1) {
    const { wrapper: alignWrapper, submenu: alignSubmenu } = createSubmenu("Alinear Selección", "📐");
    alignSubmenu.appendChild(createMenuItem("Alinear al Centro Horizontal", "", () => {
      alignSelectionToGrid(orchestrator.selectedComponents, orchestrator.gridSize, "horizontal-center");
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }, "⇥"));
    alignSubmenu.appendChild(createMenuItem("Alinear al Centro Vertical", "", () => {
      alignSelectionToGrid(orchestrator.selectedComponents, orchestrator.gridSize, "vertical-center");
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }, "⇤"));
    alignSubmenu.appendChild(createMenuItem("Ajustar a Cuadrícula (Snap Grid)", "", () => {
      alignSelectionToGrid(orchestrator.selectedComponents, orchestrator.gridSize, "snap");
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }, "▦"));
    menu.appendChild(alignWrapper);
  }

  appendDivider(menu);

  menu.appendChild(createMenuItem("Copiar Identificador (ID)", "", () => {
    navigator.clipboard.writeText(clickedComp.id);
    callbacks.log(`ID del componente copiado al portapapeles: ${clickedComp.id}`, "system");
  }, "🏷️"));

  menu.appendChild(createMenuItem("Eliminar Componente", "Supr", () => {
    orchestrator.removeSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "🗑️"));
}

function populateWireMenu(
  menu: HTMLElement,
  clickedWire: WireInstance,
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
  createMenuItem: (label: string, shortcut: string, action: () => void, icon?: string) => HTMLButtonElement,
  createSubmenu: (label: string, icon?: string) => { wrapper: HTMLElement; submenu: HTMLElement },
): void {
  orchestrator.selectedWire = clickedWire;
  orchestrator.selectedComponent = null;
  orchestrator.selectedComponents = [];
  callbacks.onSelectionChanged(null);
  callbacks.requestRender(true);

  const { wrapper: wireProbeWrapper, submenu: wireProbeSubmenu } = createSubmenu("Colocar Sonda Osciloscopio", "📍");
  const wireProbeConfigs = [
    { ch: "CH1" as const, label: "Canal 1 (CH1 - Amarillo)", icon: "🟡", defaultNode: "1" },
    { ch: "CH2" as const, label: "Canal 2 (CH2 - Celeste)", icon: "🔵", defaultNode: "2" },
    { ch: "CH3" as const, label: "Canal 3 (CH3 - Rosa)", icon: "🔴", defaultNode: "3" },
    { ch: "CH4" as const, label: "Canal 4 (CH4 - Verde)", icon: "🟢", defaultNode: "4" },
  ];
  for (const p of wireProbeConfigs) {
    wireProbeSubmenu.appendChild(createMenuItem(p.label, "", () => {
      const fromPinKey = `${clickedWire.from.componentId}:${clickedWire.from.pinIndex}`;
      const nodeId = callbacks.getPinNode(fromPinKey) ?? p.defaultNode;
      callbacks.onProbePlaced(p.ch, nodeId);
      callbacks.log(`Sonda ${p.ch} colocada en cable [${clickedWire.id}] (Nodo: ${nodeId})`, "system");
    }, p.icon));
  }
  menu.appendChild(wireProbeWrapper);

  appendDivider(menu);

  menu.appendChild(createMenuItem("Copiar ID del Cable", "", () => {
    navigator.clipboard.writeText(clickedWire.id);
    callbacks.log(`ID del cable copiado: ${clickedWire.id}`, "system");
  }, "🏷️"));

  menu.appendChild(createMenuItem("Eliminar Cable", "Supr", () => {
    orchestrator.removeSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "🗑️"));
}

function populateCanvasMenu(
  menu: HTMLElement,
  worldPt: { x: number; y: number },
  orchestrator: CanvasOrchestrator,
  callbacks: ContextMenuCallbacks,
  createMenuItem: (label: string, shortcut: string, action: () => void, icon?: string) => HTMLButtonElement,
  createSubmenu: (label: string, icon?: string) => { wrapper: HTMLElement; submenu: HTMLElement },
): void {
  const addComp = (type: ComponentInstance["type"], val: ComponentInstance["value"]) => {
    const snapped = orchestrator.snapPointToGrid(worldPt);
    const newComp = orchestrator.addComponent(type, snapped.x, snapped.y, val);
    orchestrator.selectedComponent = newComp;
    orchestrator.selectedComponents = [];
    callbacks.onSelectionChanged(newComp);
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
    callbacks.log(`Componente [${newComp.id}] insertado en (${snapped.x}, ${snapped.y})`, "system");
  };

  // 1. Agregar Componente
  const { wrapper: addWrapper, submenu: addSubmenu } = createSubmenu("Agregar Componente", "➕");

  // Pasivos
  const { wrapper: passWrapper, submenu: passSubmenu } = createSubmenu("Pasivos", "⚡");
  passSubmenu.appendChild(createMenuItem("Resistencia (1 kΩ)", "", () => addComp("resistor", 1000)));
  passSubmenu.appendChild(createMenuItem("Condensador (1 µF)", "", () => addComp("capacitor", 1e-6)));
  passSubmenu.appendChild(createMenuItem("Bobina / Inductor (1 mH)", "", () => addComp("inductor", 1e-3)));
  passSubmenu.appendChild(createMenuItem("Potenciómetro (10 kΩ)", "", () => addComp("potentiometer", 10000)));
  passSubmenu.appendChild(createMenuItem("Fotoresistencia (LDR)", "", () => addComp("ldr", 100)));
  passSubmenu.appendChild(createMenuItem("Termistor (NTC 25°C)", "", () => addComp("thermistor", 25)));
  passSubmenu.appendChild(createMenuItem("Tierra (GND 0V)", "", () => addComp("ground", 0)));
  addSubmenu.appendChild(passWrapper);

  // Semiconductores
  const { wrapper: semiWrapper, submenu: semiSubmenu } = createSubmenu("Semiconductores", "🔺");
  semiSubmenu.appendChild(createMenuItem("Diodo Rápido 1N4148", "", () => addComp("diode", "1N4148")));
  semiSubmenu.appendChild(createMenuItem("Diodo Zener (1N4733A 5.1V)", "", () => addComp("diode", "1N4733A")));
  semiSubmenu.appendChild(createMenuItem("Diodo LED Indicador", "", () => addComp("led", 0)));
  semiSubmenu.appendChild(createMenuItem("Transistor NPN (2N2222)", "", () => addComp("npn", "2N2222")));
  semiSubmenu.appendChild(createMenuItem("Transistor PNP (2N3906)", "", () => addComp("pnp", "2N3906")));
  semiSubmenu.appendChild(createMenuItem("MOSFET Canal N (NMOS)", "", () => addComp("nmos", 1)));
  semiSubmenu.appendChild(createMenuItem("MOSFET Canal P (PMOS)", "", () => addComp("pmos", 1)));
  addSubmenu.appendChild(semiWrapper);

  // Fuentes y Señales
  const { wrapper: srcWrapper, submenu: srcSubmenu } = createSubmenu("Fuentes y Señales", "🔋");
  srcSubmenu.appendChild(createMenuItem("Fuente de Tensión CC (5V)", "", () => addComp("vsource", 5)));
  srcSubmenu.appendChild(createMenuItem("Fuente de Corriente CC (1A)", "", () => addComp("isource", 1)));
  srcSubmenu.appendChild(createMenuItem("Interruptor SPST", "", () => addComp("switch", 0)));
  srcSubmenu.appendChild(createMenuItem("Transformador Acoplado", "", () => addComp("transformer", 1e-3)));
  addSubmenu.appendChild(srcWrapper);

  // Circuitos Integrados y MCUs
  const { wrapper: icWrapper, submenu: icSubmenu } = createSubmenu("Circuitos Integrados", "🎛️");
  icSubmenu.appendChild(createMenuItem("Op-Amp Ideal (3 pines)", "", () => addComp("opamp_ideal", 0)));
  icSubmenu.appendChild(createMenuItem("Comparador Ideal (3 pines)", "", () => addComp("comparator_ideal", 0)));
  icSubmenu.appendChild(createMenuItem("Amplificador Op-Amp (LM741)", "", () => addComp("opamp", "LM741")));
  icSubmenu.appendChild(createMenuItem("Temporizador NE555", "", () => addComp("x", "NE555")));
  icSubmenu.appendChild(createMenuItem("Microcontrolador 8051", "", () => addComp("mcu_8051", 0)));
  icSubmenu.appendChild(createMenuItem("Microcontrolador AVR (ATmega328P)", "", () => addComp("mcu_avr", 0)));
  addSubmenu.appendChild(icWrapper);

  // Puertos y Terminales EDA (Proteus)
  const { wrapper: noteWrapper, submenu: noteSubmenu } = createSubmenu("Puertos y Terminales (EDA)", "🏷️");
  noteSubmenu.appendChild(createMenuItem("Puerto de Red (Net Label · Configurable)", "", () => addComp("net_label", "NET_A")));
  noteSubmenu.appendChild(createMenuItem("Nota de Ingeniería (Text Note · Markdown)", "", () => addComp("text_note", "Nota de Ingeniería")));
  addSubmenu.appendChild(noteWrapper);

  menu.appendChild(addWrapper);

  // Modo Cable
  menu.appendChild(createMenuItem("Trazar Cables (Wire Mode)", "W", () => {
    callbacks.onWireMode();
  }, "✏️"));

  appendDivider(menu);

  // Vista y Navegación
  const { wrapper: viewWrapper, submenu: viewSubmenu } = createSubmenu("Vista y Navegación", "👁️");
  viewSubmenu.appendChild(createMenuItem("Ajustar a la Pantalla", "F", () => {
    callbacks.onFitAll();
  }, "📐"));
  viewSubmenu.appendChild(createMenuItem("Centrar en Origen (0,0)", "0", () => {
    orchestrator.resetCameraToCircuit();
    callbacks.requestRender(true);
  }, "🎯"));
  viewSubmenu.appendChild(createMenuItem("Alternar Etiquetas de Cables", "L", () => {
    orchestrator.showWireLabels = !orchestrator.showWireLabels;
    callbacks.requestRender(true);
  }, "🏷️"));
  menu.appendChild(viewWrapper);

  appendDivider(menu);

  if (orchestrator.hasClipboardData()) {
    menu.appendChild(createMenuItem("Pegar", "Ctrl+V", () => {
      const pasted = orchestrator.paste(worldPt);
      if (pasted && pasted.components.length > 0) {
        callbacks.onNetlistSync();
        callbacks.onSelectionChanged(
          pasted.components.length === 1 ? pasted.components[0] : null,
        );
        callbacks.requestRender(true);
        callbacks.onCanvasModified();
        callbacks.log(
          pasted.components.length === 1
            ? `Componente [${pasted.components[0].id}] pegado en el lienzo.`
            : `Lote de ${pasted.components.length} componentes pegado en el lienzo.`,
          "system",
        );
      }
    }, "📋"));
  }

  menu.appendChild(createMenuItem("Deshacer", "Ctrl+Z", () => {
    callbacks.onUndo();
    callbacks.requestRender(true);
  }, "↩️"));

  menu.appendChild(createMenuItem("Rehacer", "Ctrl+Y", () => {
    callbacks.onRedo();
    callbacks.requestRender(true);
  }, "↪️"));

  menu.appendChild(createMenuItem("Seleccionar Todo", "Ctrl+A", () => {
    callbacks.onSelectAll();
    callbacks.requestRender(true);
  }, "✂️"));

  if (orchestrator.selectedComponent || orchestrator.selectedComponents.length > 0 || orchestrator.selectedWire) {
    menu.appendChild(createMenuItem("Limpiar Selección", "Esc", () => {
      orchestrator.selectedComponent = null;
      orchestrator.selectedComponents = [];
      orchestrator.selectedWire = null;
      callbacks.onSelectionChanged(null);
      callbacks.requestRender(true);
    }, "❌"));
  }
}
