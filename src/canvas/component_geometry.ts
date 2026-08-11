import type { BoundingBox, ComponentInstance } from "../canvas_orchestrator";

/** Half-extents (local space, pre-rotation) aligned with render() geometry. */
export function getComponentLocalHalfExtents(comp: ComponentInstance): { halfW: number; halfH: number } {
  switch (comp.type) {
    case "mcu_8051":
      return { halfW: 65, halfH: 225 };
    case "mcu_avr":
      return { halfW: 65, halfH: 165 };
    case "arduino_uno":
    case "esp32":
    case "raspberry_pi_pico":
      return { halfW: 45, halfH: 65 };
    case "opamp":
      return { halfW: 45, halfH: 45 };
    case "relay":
      return { halfW: 45, halfH: 25 };
    case "switch":
      return { halfW: 45, halfH: 15 };
    case "transformer":
      return { halfW: 45, halfH: 25 };
    case "nmos":
    case "pmos":
    case "npn":
    case "pnp":
      return { halfW: 45, halfH: 45 };
    case "x": {
      const pinsLeft = Math.ceil((comp.pinCount ?? 4) / 2);
      const totalHeight = Math.max(pinsLeft * 40, 60);
      return { halfW: 65, halfH: totalHeight / 2 + 5 };
    }
    case "dmm":
      return { halfW: 30, halfH: 40 };
    default:
      return { halfW: 40, halfH: 40 };
  }
}

export function getComponentBounds(comp: ComponentInstance): BoundingBox {
  const { halfW, halfH } = getComponentLocalHalfExtents(comp);
  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const worldHalfW = halfW * cos + halfH * sin;
  const worldHalfH = halfW * sin + halfH * cos;
  return {
    x: comp.x - worldHalfW,
    y: comp.y - worldHalfH,
    width: worldHalfW * 2,
    height: worldHalfH * 2,
  };
}

export function hitTestComponentAt(
  comp: ComponentInstance,
  worldX: number,
  worldY: number,
): boolean {
  const { halfW, halfH } = getComponentLocalHalfExtents(comp);
  const rad = (-comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = worldX - comp.x;
  const dy = worldY - comp.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
}
