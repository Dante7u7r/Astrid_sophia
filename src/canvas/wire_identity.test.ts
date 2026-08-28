import { describe, expect, it } from "vitest";
import {
  createWireId,
  extractJunctionPosFromId,
  isJunctionEndpoint,
  wireEndpointKey,
} from "./wire_identity";

describe("wire_identity", () => {
  it("crea claves e ids estables para endpoints normales", () => {
    const from = { componentId: "R1", pinIndex: 0 };
    const to = { componentId: "C1", pinIndex: 1 };

    expect(wireEndpointKey(from)).toBe("R1:0");
    expect(createWireId(from, to)).toBe("wire_R1_p0_to_C1_p1");
  });

  it("reconoce y procesa endpoints de empalmes / junctions", () => {
    const jEp1 = { componentId: "j_580_397", pinIndex: 0 };
    const jEp2 = { componentId: "junction_120_240", pinIndex: 0, isJunction: true };
    const jEp3 = { componentId: "R2", pinIndex: 1, isJunction: true, junctionPos: { x: 50, y: 80 } };

    expect(isJunctionEndpoint(jEp1)).toBe(true);
    expect(isJunctionEndpoint(jEp2)).toBe(true);
    expect(isJunctionEndpoint(jEp3)).toBe(true);
    expect(isJunctionEndpoint({ componentId: "R1", pinIndex: 0 })).toBe(false);

    expect(extractJunctionPosFromId("j_580_397")).toEqual({ x: 580, y: 397 });
    expect(extractJunctionPosFromId("junction_120_240")).toEqual({ x: 120, y: 240 });
    expect(extractJunctionPosFromId("R1")).toBeUndefined();

    expect(wireEndpointKey(jEp1)).toBe("junction:580_397");
    expect(wireEndpointKey(jEp3)).toBe("junction:50_80");

    const wireId = createWireId({ componentId: "R1", pinIndex: 1 }, jEp1);
    expect(wireId).toBe("wire_R1_p1_to_j_580_397");
  });
});
