import type { ComponentInstance, WireInstance } from "../canvas_orchestrator";
import {
  DMM_INITIAL_DISPLAY,
  normalizeDmmMode,
} from "../simulation/dmm";
import {
  copyComponentConfiguration,
  generateUniqueComponentId,
  isValidComponentId,
  normalizeComponentId,
} from "./component_identity";
import { createWireId } from "./wire_identity";

export interface SelectionMutation {
  selectedComponent: ComponentInstance | null;
  selectedComponents: ComponentInstance[];
  wires: WireInstance[];
}

export function createComponent(
  components: readonly ComponentInstance[],
  type: ComponentInstance["type"],
  x: number,
  y: number,
  value: number | string,
  snapToGrid: (value: number) => number,
): ComponentInstance {
  const newComp: ComponentInstance = {
    id: generateUniqueComponentId(components, type),
    type,
    value,
    x: snapToGrid(x),
    y: snapToGrid(y),
    rotation: 0,
  };

  if (type === "dmm") {
    newComp.value = normalizeDmmMode(value);
    newComp.dmmValue = DMM_INITIAL_DISPLAY;
  } else if (type === "potentiometer") {
    newComp.wiperPosition = 0.5;
  } else if (type === "ldr") {
    newComp.lux = 100;
  } else if (type === "thermistor") {
    newComp.temperatureCelsius = 25;
  } else if (type === "transformer") {
    const inductance = typeof value === "number" && value > 0 ? value : 1e-3;
    newComp.primaryInductance = inductance;
    newComp.secondaryInductance = inductance;
    newComp.couplingCoefficient = 0.9;
  } else if (type === "switch") {
    newComp.switchRon = 0.01;
    newComp.switchRoff = 1e9;
    newComp.switchVth = 0.5;
    newComp.switchVh = 0.05;
    newComp.switchState = false;
  } else if (type === "opamp") {
    newComp.offsetVoltage = 0.002;
    newComp.openLoopGain = 100_000;
  } else if (type === "mcu_8051" || type === "mcu_avr") {
    const defaultClock = type === "mcu_avr" ? 16e6 : 12e6;
    newComp.mcuClockSpeed = typeof value === "number" && value > 0
      ? value
      : defaultClock;
  } else if (type === "x") {
    newComp.pinCount = 4;
  }

  return newComp;
}

export function renameComponentInCircuit(
  components: readonly ComponentInstance[],
  wires: WireInstance[],
  component: ComponentInstance,
  requestedId: string,
): string | null {
  const newId = requestedId.trim();
  const oldId = component.id;

  if (!isValidComponentId(newId)) {
    return "El identificador debe comenzar con una letra y contener solo letras, numeros o guion bajo.";
  }

  const normalizedNewId = normalizeComponentId(newId);
  const duplicate = components.some(
    candidate => candidate !== component && normalizeComponentId(candidate.id) === normalizedNewId,
  );
  if (duplicate) {
    return `El identificador [${newId}] ya existe en el circuito.`;
  }

  if (newId === oldId) return null;

  component.id = newId;
  for (const wire of wires) {
    if (wire.from.componentId === oldId) wire.from.componentId = newId;
    if (wire.to.componentId === oldId) wire.to.componentId = newId;
    wire.id = createWireId(wire.from, wire.to);
  }
  return null;
}

export function removeComponentFromCircuit(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  selectedComponents: readonly ComponentInstance[],
  id: string,
): {
  components: ComponentInstance[];
  wires: WireInstance[];
  selectedComponents: ComponentInstance[];
} {
  return {
    components: components.filter(component => component.id !== id),
    wires: wires.filter(wire => wire.from.componentId !== id && wire.to.componentId !== id),
    selectedComponents: selectedComponents.filter(component => component.id !== id),
  };
}

export function rotateSelection(
  selectedComponents: readonly ComponentInstance[],
  selectedComponent: ComponentInstance | null,
  deltaDegrees: number,
): void {
  const targets = selectedComponents.length > 0
    ? selectedComponents
    : selectedComponent
      ? [selectedComponent]
      : [];

  for (const comp of targets) {
    comp.rotation = (comp.rotation + deltaDegrees + 360) % 360;
  }
}

export function mirrorSelection(
  selectedComponents: readonly ComponentInstance[],
  selectedComponent: ComponentInstance | null,
): void {
  const targets = selectedComponents.length > 0
    ? selectedComponents
    : selectedComponent
      ? [selectedComponent]
      : [];

  for (const comp of targets) {
    comp.mirror = !comp.mirror;
  }
}

export function duplicateSelection(
  selectedComponents: ComponentInstance[],
  selectedComponent: ComponentInstance | null,
  addComponent: (
    type: ComponentInstance["type"],
    x: number,
    y: number,
    value: number | string,
  ) => ComponentInstance,
  offset = 40,
): {
  selectedComponent: ComponentInstance | null;
  selectedComponents: ComponentInstance[];
} {
  if (selectedComponents.length > 0) {
    const newSelection: ComponentInstance[] = [];
    for (const comp of selectedComponents) {
      const dup = addComponent(comp.type, comp.x + offset, comp.y + offset, comp.value);
      copyComponentConfiguration(comp, dup);
      newSelection.push(dup);
    }
    for (const comp of selectedComponents) {
      comp.selected = false;
    }
    for (const comp of newSelection) {
      comp.selected = true;
    }
    return {
      selectedComponent: null,
      selectedComponents: newSelection,
    };
  }

  if (selectedComponent) {
    const dup = addComponent(
      selectedComponent.type,
      selectedComponent.x + offset,
      selectedComponent.y + offset,
      selectedComponent.value,
    );
    copyComponentConfiguration(selectedComponent, dup);
    return {
      selectedComponent: dup,
      selectedComponents: [],
    };
  }

  return {
    selectedComponent,
    selectedComponents,
  };
}

export function removeSelection(
  components: readonly ComponentInstance[],
  wires: readonly WireInstance[],
  selectedWire: WireInstance | null,
  selectedComponents: readonly ComponentInstance[],
  selectedComponent: ComponentInstance | null,
): SelectionMutation & { components: ComponentInstance[]; selectedWire: WireInstance | null } {
  if (selectedWire) {
    return {
      components: [...components],
      wires: wires.filter(wire => wire.id !== selectedWire.id),
      selectedWire: null,
      selectedComponent,
      selectedComponents: [...selectedComponents],
    };
  }

  const idsToRemove = new Set<string>();
  if (selectedComponents.length > 0) {
    for (const comp of selectedComponents) idsToRemove.add(comp.id);
  } else if (selectedComponent) {
    idsToRemove.add(selectedComponent.id);
  }

  if (idsToRemove.size === 0) {
    return {
      components: [...components],
      wires: [...wires],
      selectedWire: null,
      selectedComponent,
      selectedComponents: [...selectedComponents],
    };
  }

  return {
    components: components.filter(component => !idsToRemove.has(component.id)),
    wires: wires.filter(
      wire => !idsToRemove.has(wire.from.componentId) && !idsToRemove.has(wire.to.componentId),
    ),
    selectedWire: null,
    selectedComponent: null,
    selectedComponents: [],
  };
}
