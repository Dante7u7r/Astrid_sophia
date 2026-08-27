/**
 * TopologicalFixes — Auto-Corrección Topológica Asistida en el Lienzo
 *
 * Implementa acciones que modifican el esquemático con un solo clic:
 * - Inserción y conexión de GND de referencia.
 * - Inserción de diodo flyback en antiparalelo con inductores conmutados.
 * - Inserción de condensadores de desacoplo de 100 nF entre VCC y GND.
 * - Inserción de resistencias de pull-up (10k a VCC) o pull-down (10k a GND).
 */

import type { CanvasOrchestrator } from "../canvas_orchestrator";

export type TopologicalFixAction =
  | { readonly type: "add_ground"; readonly targetNode?: string; readonly x?: number; readonly y?: number }
  | { readonly type: "add_flyback_diode"; readonly inductorId: string; readonly anodeNode: string; readonly cathodeNode: string }
  | { readonly type: "add_decoupling_cap"; readonly vccNode: string; readonly gndNode?: string; readonly capacitanceFarads?: number }
  | { readonly type: "add_pullup_resistor"; readonly pinNode: string; readonly vccNode: string; readonly resistanceOhms?: number }
  | { readonly type: "add_pulldown_resistor"; readonly pinNode: string; readonly gndNode?: string; readonly resistanceOhms?: number };

/**
 * Aplica un parche topológico directamente sobre la instancia del CanvasOrchestrator.
 */
export function applyTopologicalFix(
  orchestrator: CanvasOrchestrator,
  fix: TopologicalFixAction,
): boolean {
  if (!orchestrator) return false;

  switch (fix.type) {
    case "add_ground": {
      // Buscar una posición adecuada en la parte inferior del circuito
      let maxX = 200;
      let maxY = 300;
      if (orchestrator.components.length > 0) {
        for (const c of orchestrator.components) {
          if (c.x > maxX) maxX = c.x;
          if (c.y > maxY) maxY = c.y;
        }
      }
      const gndX = fix.x ?? maxX - 60;
      const gndY = fix.y ?? maxY + 60;

      const gnd = orchestrator.addComponent("ground", gndX, gndY, 0);
      if (!gnd) return false;

      // Si se especifica un nodo objetivo, buscar el pin correspondiente y cablear
      if (fix.targetNode) {
        const targetComp = orchestrator.components.find((c) => ((c as unknown as { pins?: string[] }).pins?.includes(fix.targetNode!)));
        if (targetComp) {
          const compPins = (targetComp as unknown as { pins?: string[] }).pins || [];
          const pinIdx = compPins.indexOf(fix.targetNode);
          const targetPin = orchestrator.getComponentPins(targetComp)[pinIdx];
          const gndPin = orchestrator.getComponentPins(gnd)[0];
          if (targetPin && gndPin) {
            orchestrator.addWire(
              [
                { x: targetPin.x, y: targetPin.y },
                { x: targetPin.x, y: gndPin.y },
                { x: gndPin.x, y: gndPin.y },
              ],
              { componentId: targetComp.id, pinIndex: pinIdx },
              { componentId: gnd.id, pinIndex: 0 },
            );
          }
        }
      }
      break;
    }

    case "add_flyback_diode": {
      const inductor = orchestrator.components.find((c) => c.id === fix.inductorId);
      if (!inductor) return false;

      // Colocar el diodo en paralelo junto al inductor
      const diodeX = inductor.x + 80;
      const diodeY = inductor.y;

      const diode = orchestrator.addComponent("diode", diodeX, diodeY, 1);
      if (!diode) return false;

      const indPins = orchestrator.getComponentPins(inductor);
      const diodePins = orchestrator.getComponentPins(diode);

      if (indPins.length >= 2 && diodePins.length >= 2) {
        // Conectar Ánodo y Cátodo a los bornes del inductor
        orchestrator.addWire(
          [{ x: indPins[0].x, y: indPins[0].y }, { x: diodePins[1].x, y: diodePins[1].y }],
          { componentId: inductor.id, pinIndex: 0 },
          { componentId: diode.id, pinIndex: 1 },
        );
        orchestrator.addWire(
          [{ x: indPins[1].x, y: indPins[1].y }, { x: diodePins[0].x, y: diodePins[0].y }],
          { componentId: inductor.id, pinIndex: 1 },
          { componentId: diode.id, pinIndex: 0 },
        );
      }
      break;
    }

    case "add_decoupling_cap": {
      const capVal = fix.capacitanceFarads ?? 100e-9; // 100 nF
      let posX = 160;
      let posY = 160;
      if (orchestrator.components.length > 0) {
        posX = orchestrator.components[0].x + 40;
        posY = orchestrator.components[0].y + 80;
      }

      const cap = orchestrator.addComponent("capacitor", posX, posY, capVal);
      if (!cap) return false;
      break;
    }

    case "add_pullup_resistor": {
      const resVal = fix.resistanceOhms ?? 10000; // 10 kΩ
      let posX = 180;
      let posY = 140;
      if (orchestrator.components.length > 0) {
        posX = orchestrator.components[0].x + 60;
        posY = orchestrator.components[0].y - 60;
      }

      const res = orchestrator.addComponent("resistor", posX, posY, resVal);
      if (!res) return false;
      break;
    }

    case "add_pulldown_resistor": {
      const resVal = fix.resistanceOhms ?? 10000; // 10 kΩ
      let posX = 180;
      let posY = 240;
      if (orchestrator.components.length > 0) {
        posX = orchestrator.components[0].x + 60;
        posY = orchestrator.components[0].y + 80;
      }

      const res = orchestrator.addComponent("resistor", posX, posY, resVal);
      if (!res) return false;
      break;
    }

    default:
      return false;
  }

  orchestrator.syncWireConnections();
  orchestrator.render();
  return true;
}
