import { describe, it, expect } from "vitest";
import { resolveDemoProbeTargets } from "./demo_auto_setup";
import type { ComponentInstance } from "../canvas_orchestrator";

describe("demo_auto_setup", () => {
  it("resolves probe nodes from explicit net labels VIN and VOUT", () => {
    const components: ComponentInstance[] = [
      { id: "NET_VIN", type: "net_label", value: "NET_VIN", x: 100, y: 100, rotation: 0 },
      { id: "NET_VOUT", type: "net_label", value: "NET_VOUT", x: 300, y: 100, rotation: 0 },
    ];
    const pinMap = {
      "NET_VIN:0": "1",
      "NET_VOUT:0": "2",
    };

    const targets = resolveDemoProbeTargets(components, pinMap);
    expect(targets.ch1Node).toBe("1");
    expect(targets.ch2Node).toBe("2");
  });

  it("resolves CH1 from primary voltage source when no net label is present", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 100, y: 100, rotation: 0 },
      { id: "R1", type: "resistor", value: 1000, x: 200, y: 100, rotation: 0 },
    ];
    const pinMap = {
      "V1:0": "1",
      "V1:1": "0",
      "R1:0": "1",
      "R1:1": "2",
    };

    const targets = resolveDemoProbeTargets(components, pinMap);
    expect(targets.ch1Node).toBe("1");
    expect(targets.ch2Node).toBe("2");
  });

  it("resolves CH2 from OpAmp output pin", () => {
    const components: ComponentInstance[] = [
      { id: "V1", type: "vsource", value: 5, x: 100, y: 100, rotation: 0 },
      { id: "U1", type: "opamp", value: "LM741", x: 200, y: 100, rotation: 0 },
    ];
    const pinMap = {
      "V1:0": "1",
      "V1:1": "0",
      "U1:0": "1",
      "U1:1": "0",
      "U1:4": "3", // Output pin
    };

    const targets = resolveDemoProbeTargets(components, pinMap);
    expect(targets.ch1Node).toBe("1");
    expect(targets.ch2Node).toBe("3");
  });
});
