import { describe, expect, it } from "vitest";
import {
  expandBusLabel,
  getBusWidth,
  isBusLabel,
  matchBusMember,
  parseBusLabel,
} from "./bus_wiring";

describe("bus_wiring", () => {
  it("parsea etiquetas de bus vectorial ascendentes y descendentes", () => {
    const bus8 = parseBusLabel("DATA[0:7]");
    expect(bus8.isBus).toBe(true);
    expect(bus8.baseName).toBe("DATA");
    expect(bus8.start).toBe(0);
    expect(bus8.end).toBe(7);
    expect(bus8.width).toBe(8);
    expect(bus8.members).toEqual([
      "DATA[0]",
      "DATA[1]",
      "DATA[2]",
      "DATA[3]",
      "DATA[4]",
      "DATA[5]",
      "DATA[6]",
      "DATA[7]",
    ]);

    const busDesc = parseBusLabel("ADDR[15:0]");
    expect(busDesc.isBus).toBe(true);
    expect(busDesc.baseName).toBe("ADDR");
    expect(busDesc.start).toBe(15);
    expect(busDesc.end).toBe(0);
    expect(busDesc.width).toBe(16);
    expect(busDesc.members[0]).toBe("ADDR[15]");
    expect(busDesc.members[15]).toBe("ADDR[0]");

    const busDots = parseBusLabel("BUS[0..3]");
    expect(busDots.isBus).toBe(true);
    expect(busDots.width).toBe(4);
    expect(busDots.members).toEqual(["BUS[0]", "BUS[1]", "BUS[2]", "BUS[3]"]);
  });

  it("parsea miembros individuales de bus indexados", () => {
    const memberBracket = parseBusLabel("DATA[3]");
    expect(memberBracket.isBus).toBe(false);
    expect(memberBracket.isBusMember).toBe(true);
    expect(memberBracket.baseName).toBe("DATA");
    expect(memberBracket.index).toBe(3);
    expect(memberBracket.width).toBe(1);
    expect(memberBracket.members).toEqual(["DATA[3]"]);

    const memberUnderscore = parseBusLabel("ADDR_7");
    expect(memberUnderscore.isBus).toBe(false);
    expect(memberUnderscore.isBusMember).toBe(true);
    expect(memberUnderscore.baseName).toBe("ADDR");
    expect(memberUnderscore.index).toBe(7);
    expect(memberUnderscore.members).toEqual(["ADDR[7]"]);
  });

  it("parsea etiquetas escalares estándar", () => {
    const scalar = parseBusLabel("VCC");
    expect(scalar.isBus).toBe(false);
    expect(scalar.isBusMember).toBe(false);
    expect(scalar.baseName).toBe("VCC");
    expect(scalar.width).toBe(1);
    expect(scalar.members).toEqual(["VCC"]);
  });

  it("expande etiquetas correctamente y reporta propiedades de bus", () => {
    expect(isBusLabel("DATA[0:7]")).toBe(true);
    expect(isBusLabel("DATA[3]")).toBe(false);
    expect(isBusLabel("RESET")).toBe(false);

    expect(getBusWidth("DATA[0:7]")).toBe(8);
    expect(getBusWidth("ADDR[15:0]")).toBe(16);
    expect(getBusWidth("CLK")).toBe(1);

    expect(expandBusLabel("CONTROL[0:1]")).toEqual(["CONTROL[0]", "CONTROL[1]"]);
    expect(expandBusLabel("VOUT")).toEqual(["VOUT"]);
  });

  it("valida la pertenencia de un miembro a un bus con matchBusMember", () => {
    expect(matchBusMember("DATA[0:7]", "DATA[3]")).toEqual({ matches: true, bitIndex: 3 });
    expect(matchBusMember("DATA[0:7]", "DATA_5")).toEqual({ matches: true, bitIndex: 5 });
    expect(matchBusMember("DATA[0:7]", "DATA[9]")).toEqual({ matches: false });
    expect(matchBusMember("DATA[0:7]", "ADDR[3]")).toEqual({ matches: false });
    expect(matchBusMember("CLK", "CLK")).toEqual({ matches: false });
  });
});
