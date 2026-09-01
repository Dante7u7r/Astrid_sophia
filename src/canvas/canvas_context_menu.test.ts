import { describe, expect, it } from "vitest";
import { alignSelectionToGrid } from "./canvas_context_menu";

describe("canvas context menu grid alignment", () => {
  it("alinea horizontalmente usando el tamaño de cuadrícula configurado", () => {
    const components = [{ x: 3, y: 11 }, { x: 27, y: 26 }];

    alignSelectionToGrid(components, 10, "horizontal-center");

    expect(components).toEqual([{ x: 3, y: 20 }, { x: 27, y: 20 }]);
  });

  it("alinea verticalmente usando una cuadrícula distinta de 20 px", () => {
    const components = [{ x: 3, y: 11 }, { x: 13, y: 26 }, { x: 21, y: 40 }];

    alignSelectionToGrid(components, 5, "vertical-center");

    expect(components.map((component) => component.x)).toEqual([10, 10, 10]);
  });

  it("ajusta ambas coordenadas y rechaza tamaños de cuadrícula inválidos", () => {
    const components = [{ x: 13, y: 24 }, { x: -16, y: -5 }];

    alignSelectionToGrid(components, 8, "snap");

    expect(components).toEqual([{ x: 16, y: 24 }, { x: -16, y: -8 }]);
    expect(() => alignSelectionToGrid(components, 0, "snap")).toThrow(RangeError);
  });
});
