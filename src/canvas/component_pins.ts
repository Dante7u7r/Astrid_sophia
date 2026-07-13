import type { ComponentInstance, PinInstance, Point2D } from "../canvas_orchestrator";

export function getComponentPins(comp: ComponentInstance): PinInstance[] {
  const pins: PinInstance[] = [];
  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const getRotatedOffset = (lx: number, ly: number): Point2D => {
    const finalLx = comp.mirror ? -lx : lx;
    return {
      x: comp.x + (finalLx * cos - ly * sin),
      y: comp.y + (finalLx * sin + ly * cos),
    };
  };

  if (comp.type === "ground") {
    const pt = getRotatedOffset(0, -20);
    pins.push({ componentId: comp.id, pinIndex: 0, x: pt.x, y: pt.y });
  } else if (comp.type === "nmos" || comp.type === "pmos" || comp.type === "npn" || comp.type === "pnp") {
    const ptGate = getRotatedOffset(-40, 0);
    const ptDrain = getRotatedOffset(20, -40);
    const ptSource = getRotatedOffset(20, 40);
    pins.push({ componentId: comp.id, pinIndex: 0, x: ptGate.x, y: ptGate.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: ptDrain.x, y: ptDrain.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: ptSource.x, y: ptSource.y });
  } else if (comp.type === "opamp") {
    const ptInPos = getRotatedOffset(-40, -15);
    const ptInNeg = getRotatedOffset(-40, 15);
    const ptVplus = getRotatedOffset(0, -40);
    const ptVminus = getRotatedOffset(0, 40);
    const ptOut = getRotatedOffset(40, 0);
    pins.push({ componentId: comp.id, pinIndex: 0, x: ptInPos.x, y: ptInPos.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: ptInNeg.x, y: ptInNeg.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: ptVplus.x, y: ptVplus.y });
    pins.push({ componentId: comp.id, pinIndex: 3, x: ptVminus.x, y: ptVminus.y });
    pins.push({ componentId: comp.id, pinIndex: 4, x: ptOut.x, y: ptOut.y });
  } else if (comp.type === "relay") {
    const ptCoilA = getRotatedOffset(-40, -20);
    const ptCoilB = getRotatedOffset(-40, 20);
    const ptCommon = getRotatedOffset(40, -20);
    const ptNo = getRotatedOffset(40, 20);
    pins.push({ componentId: comp.id, pinIndex: 0, x: ptCoilA.x, y: ptCoilA.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: ptCoilB.x, y: ptCoilB.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: ptCommon.x, y: ptCommon.y });
    pins.push({ componentId: comp.id, pinIndex: 3, x: ptNo.x, y: ptNo.y });
  } else if (comp.type === "potentiometer") {
    const ptA = getRotatedOffset(-40, 0);
    const ptWiper = getRotatedOffset(0, 40);
    const ptB = getRotatedOffset(40, 0);
    pins.push({ componentId: comp.id, pinIndex: 0, x: ptA.x, y: ptA.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: ptWiper.x, y: ptWiper.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: ptB.x, y: ptB.y });
  } else if (comp.type === "mcu_8051") {
    for (let i = 0; i < 20; i++) {
      const pt = getRotatedOffset(-60, -200 + i * 20);
      pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
    }
    for (let i = 0; i < 20; i++) {
      const pt = getRotatedOffset(60, 180 - i * 20);
      pins.push({ componentId: comp.id, pinIndex: 20 + i, x: pt.x, y: pt.y });
    }
  } else if (comp.type === "mcu_avr") {
    for (let i = 0; i < 14; i++) {
      const pt = getRotatedOffset(-60, -140 + i * 20);
      pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
    }
    for (let i = 0; i < 14; i++) {
      const pt = getRotatedOffset(60, 120 - i * 20);
      pins.push({ componentId: comp.id, pinIndex: 14 + i, x: pt.x, y: pt.y });
    }
  } else if (comp.type === "arduino_uno" || comp.type === "esp32" || comp.type === "raspberry_pi_pico") {
    const pt0 = getRotatedOffset(-40, -40);
    const pt1 = getRotatedOffset(40, -40);
    const pt2 = getRotatedOffset(-40, 0);
    const pt3 = getRotatedOffset(40, 0);
    const pt4 = getRotatedOffset(-40, 40);
    const pt5 = getRotatedOffset(40, 40);
    pins.push({ componentId: comp.id, pinIndex: 0, x: pt0.x, y: pt0.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: pt1.x, y: pt1.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: pt2.x, y: pt2.y });
    pins.push({ componentId: comp.id, pinIndex: 3, x: pt3.x, y: pt3.y });
    pins.push({ componentId: comp.id, pinIndex: 4, x: pt4.x, y: pt4.y });
    pins.push({ componentId: comp.id, pinIndex: 5, x: pt5.x, y: pt5.y });
  } else if (comp.type === "transformer") {
    const ptPri1 = getRotatedOffset(-40, -20);
    const ptPri2 = getRotatedOffset(-40, 20);
    const ptSec1 = getRotatedOffset(40, -20);
    const ptSec2 = getRotatedOffset(40, 20);
    pins.push({ componentId: comp.id, pinIndex: 0, x: ptPri1.x, y: ptPri1.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: ptPri2.x, y: ptPri2.y });
    pins.push({ componentId: comp.id, pinIndex: 2, x: ptSec1.x, y: ptSec1.y });
    pins.push({ componentId: comp.id, pinIndex: 3, x: ptSec2.x, y: ptSec2.y });
  } else if (comp.type === "x") {
    const pinCount = comp.pinCount ?? 4;
    const pinsLeft = Math.ceil(pinCount / 2);
    const totalHeight = Math.max(pinsLeft * 40, 60);
    const halfH = totalHeight / 2;

    for (let i = 0; i < pinCount; i++) {
      const pos = Math.floor(i / 2);
      const yOffset = -halfH + 20 + pos * 40;
      const pt = getRotatedOffset(i % 2 === 0 ? -60 : 60, yOffset);
      pins.push({ componentId: comp.id, pinIndex: i, x: pt.x, y: pt.y });
    }
  } else {
    const pt1 = getRotatedOffset(-40, 0);
    const pt2 = getRotatedOffset(40, 0);
    pins.push({ componentId: comp.id, pinIndex: 0, x: pt1.x, y: pt1.y });
    pins.push({ componentId: comp.id, pinIndex: 1, x: pt2.x, y: pt2.y });
  }

  return pins;
}
