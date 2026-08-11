import { describe, expect, it } from "vitest";
import { createWireId, wireEndpointKey } from "./wire_identity";

describe("wire_identity", () => {
  it("crea claves e ids estables para endpoints", () => {
    const from = { componentId: "R1", pinIndex: 0 };
    const to = { componentId: "C1", pinIndex: 1 };

    expect(wireEndpointKey(from)).toBe("R1:0");
    expect(createWireId(from, to)).toBe("wire_R1_p0_to_C1_p1");
  });
});
