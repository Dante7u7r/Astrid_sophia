import { describe, expect, it } from "vitest";
import { normalizeSpiceLines, parseSpiceLibrary } from "./spice_library_parser";

describe("spice_library_parser", () => {
  it("normaliza saltos de línea y continuaciones con '+'", () => {
    const raw = `
* Comentario inicial
.SUBCKT LM741 IN_POS IN_NEG
+ VCC VEE
+ OUTPUT
R1 IN_POS IN_NEG 10Meg
.ENDS LM741
    `;
    const lines = normalizeSpiceLines(raw);
    expect(lines).toContain(".SUBCKT LM741 IN_POS IN_NEG VCC VEE OUTPUT");
    expect(lines).toContain("R1 IN_POS IN_NEG 10Meg");
    expect(lines).toContain(".ENDS LM741");
  });

  it("parsea múltiples subcircuitos y modelos en un solo archivo de biblioteca", () => {
    const libraryText = `
* ==========================================
* Texas Instruments General Purpose OpAmps
* ==========================================

* Amplificador Operacional Estándar LM741
.SUBCKT LM741 NON_INV INV VCC VEE OUT PARAMS: GAIN=200000 GBW=1MEG
Rin NON_INV INV 2Meg
Eout OUT 0 NON_INV INV {GAIN}
.ENDS LM741

* Temporizador de precisión NE555
.SUBCKT NE555 GND TRIG OUT RESET CTRL THRES DISCH VCC
R1 VCC CTRL 5k
R2 CTRL THRES 5k
R3 THRES GND 5k
.ENDS NE555

* Modelo de Diodo 1N4148
.MODEL D1N4148 D(Is=2.52n Rs=0.568 N=1.752 Cjo=4p Tt=5.7n)
    `;

    const result = parseSpiceLibrary(libraryText);

    expect(result.subcircuits).toHaveLength(2);
    expect(result.models).toHaveLength(1);

    // Subcircuito 1: LM741
    const lm741 = result.subcircuits[0];
    expect(lm741.name).toBe("LM741");
    expect(lm741.pinNames).toEqual(["NON_INV", "INV", "VCC", "VEE", "OUT"]);
    expect(lm741.pinCount).toBe(5);
    expect(lm741.pinLabels).toEqual({
      0: "NON_INV",
      1: "INV",
      2: "VCC",
      3: "VEE",
      4: "OUT",
    });
    expect(lm741.category).toBe("Amplificadores");
    expect(lm741.suggestedType).toBe("opamp");
    expect(lm741.defaultParams).toEqual({ GAIN: 200000, GBW: 1000000 });

    // Subcircuito 2: NE555
    const ne555 = result.subcircuits[1];
    expect(ne555.name).toBe("NE555");
    expect(ne555.pinNames).toEqual(["GND", "TRIG", "OUT", "RESET", "CTRL", "THRES", "DISCH", "VCC"]);
    expect(ne555.pinCount).toBe(8);
    expect(ne555.category).toBe("Temporizadores");
    expect(ne555.suggestedType).toBe("timer");

    // Modelo: D1N4148
    const d1n4148 = result.models[0];
    expect(d1n4148.name).toBe("D1N4148");
    expect(d1n4148.type).toBe("d");
  });

  it("maneja archivos vacíos o sin subcircuitos", () => {
    const result = parseSpiceLibrary("* Solo comentarios\n* Sin directivas");
    expect(result.subcircuits).toEqual([]);
    expect(result.models).toEqual([]);
  });
});
