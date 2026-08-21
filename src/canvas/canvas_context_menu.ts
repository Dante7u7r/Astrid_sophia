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
>;

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
    populateWireMenu(menu, clickedWire, orchestrator, callbacks, createMenuItem);
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

  menu.appendChild(createMenuItem("Espejar (Mirror)", "M", () => {
    orchestrator.mirrorSelectedComponent();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
  }, "🪞"));

  menu.appendChild(createMenuItem("Duplicar", "Ctrl+D", () => {
    orchestrator.duplicateSelected();
    callbacks.requestRender(true);
    callbacks.onCanvasModified();
    callbacks.onNetlistSync();
  }, "📋"));

  // Submenú Sondas
  const { wrapper: probeWrapper, submenu: probeSubmenu } = createSubmenu("Colocar Sonda", "🎯");
  probeSubmenu.appendChild(createMenuItem("Canal 1 (CH1 - Cian)", "", () => {
    const pin0Key = `${clickedComp.id}:0`;
    const nodeId = callbacks.getPinNode(pin0Key) ?? "1";
    callbacks.onProbePlaced("CH1", nodeId);
    callbacks.log(`Sonda CH1 conectada a pin 1 de [${clickedComp.id}] (Nodo: ${nodeId})`, "system");
  }, "🔵"));
  probeSubmenu.appendChild(createMenuItem("Canal 2 (CH2 - Violeta)", "", () => {
    const pin1Key = `${clickedComp.id}:1`;
    const nodeId = callbacks.getPinNode(pin1Key) ?? "2";
    callbacks.onProbePlaced("CH2", nodeId);
    callbacks.log(`Sonda CH2 conectada a pin 2 de [${clickedComp.id}] (Nodo: ${nodeId})`, "system");
  }, "🟣"));
  menu.appendChild(probeWrapper);

  // Submenú Alineación (si hay selección múltiple)
  if (orchestrator.selectedComponents.length > 1) {
    const { wrapper: alignWrapper, submenu: alignSubmenu } = createSubmenu("Alinear Selección", "📐");
    alignSubmenu.appendChild(createMenuItem("Alinear al Centro Horizontal", "", () => {
      const avgY = orchestrator.selectedComponents.reduce((acc, c) => acc + c.y, 0) / orchestrator.selectedComponents.length;
      const snappedY = Math.round(avgY / 20) * 20;
      orchestrator.selectedComponents.forEach(c => { c.y = snappedY; });
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }, "⇥"));
    alignSubmenu.appendChild(createMenuItem("Alinear al Centro Vertical", "", () => {
      const avgX = orchestrator.selectedComponents.reduce((acc, c) => acc + c.x, 0) / orchestrator.selectedComponents.length;
      const snappedX = Math.round(avgX / 20) * 20;
      orchestrator.selectedComponents.forEach(c => { c.x = snappedX; });
      callbacks.requestRender(true);
      callbacks.onCanvasModified();
    }, "⇤"));
    alignSubmenu.appendChild(createMenuItem("Ajustar a Cuadrícula (Snap Grid)", "", () => {
      orchestrator.selectedComponents.forEach(c => {
        c.x = Math.round(c.x / 20) * 20;
        c.y = Math.round(c.y / 20) * 20;
      });
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
): void {
  orchestrator.selectedWire = clickedWire;
  orchestrator.selectedComponent = null;
  orchestrator.selectedComponents = [];
  callbacks.onSelectionChanged(null);
  callbacks.requestRender(true);

  menu.appendChild(createMenuItem("Sonda CH1 en este Cable", "", () => {
    const fromPinKey = `${clickedWire.from.componentId}:${clickedWire.from.pinIndex}`;
    const nodeId = callbacks.getPinNode(fromPinKey) ?? "1";
    callbacks.onProbePlaced("CH1", nodeId);
    callbacks.log(`Sonda CH1 colocada en pista [${clickedWire.id}] (Nodo: ${nodeId})`, "system");
  }, "🔵"));

  menu.appendChild(createMenuItem("Sonda CH2 en este Cable", "", () => {
    const fromPinKey = `${clickedWire.from.componentId}:${clickedWire.from.pinIndex}`;
    const nodeId = callbacks.getPinNode(fromPinKey) ?? "2";
    callbacks.onProbePlaced("CH2", nodeId);
    callbacks.log(`Sonda CH2 colocada en pista [${clickedWire.id}] (Nodo: ${nodeId})`, "system");
  }, "🟣"));

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
  icSubmenu.appendChild(createMenuItem("Amplificador Op-Amp (LM741)", "", () => addComp("opamp", "LM741")));
  icSubmenu.appendChild(createMenuItem("Temporizador NE555", "", () => addComp("x", "NE555")));
  icSubmenu.appendChild(createMenuItem("Microcontrolador 8051", "", () => addComp("mcu_8051", 0)));
  icSubmenu.appendChild(createMenuItem("Microcontrolador AVR (ATmega328P)", "", () => addComp("mcu_avr", 0)));
  addSubmenu.appendChild(icWrapper);

  // Puertos y Terminales EDA (Proteus)
  const { wrapper: noteWrapper, submenu: noteSubmenu } = createSubmenu("Puertos y Terminales (EDA)", "🏷️");
  noteSubmenu.appendChild(createMenuItem("Terminal de Alimentación (+5V VCC · V-Source virtual)", "", () => addComp("net_label", "+5V")));
  noteSubmenu.appendChild(createMenuItem("Terminal de Alimentación (+3.3V VDD · V-Source virtual)", "", () => addComp("net_label", "+3.3V")));
  noteSubmenu.appendChild(createMenuItem("Terminal de Alimentación (+12V · V-Source virtual)", "", () => addComp("net_label", "+12V")));
  noteSubmenu.appendChild(createMenuItem("Terminal de Alimentación (-12V · V-Source virtual)", "", () => addComp("net_label", "-12V")));
  noteSubmenu.appendChild(createMenuItem("Terminal de Tierra (GND / Nodo 0)", "", () => addComp("net_label", "GND")));
  noteSubmenu.appendChild(createMenuItem("Terminal de Reloj / Pulso (CLK · Generador virtual)", "", () => addComp("net_label", "CLK")));
  noteSubmenu.appendChild(createMenuItem("Puerto de Red (Net Label · Unión sin fuente)", "", () => addComp("net_label", "NET_A")));
  noteSubmenu.appendChild(createMenuItem("Nota de Documentación Técnica", "", () => addComp("text_note", "Nota técnica")));
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
