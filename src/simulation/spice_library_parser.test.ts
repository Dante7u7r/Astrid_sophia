import { describe, expect, it } from "vitest";
import {
  normalizeSpiceLines,
  parseSpiceLibrary,
  extractPinNamesFromHeaderComments,
  evaluateSpiceExpression,
  evaluateSpiceParamExpressions,
} from "./spice_library_parser";

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

  it("extrae nombres semánticos de pines desde comentarios de cabecera con formato PIN o CONNECTIONS", () => {
    // Formato 1: PIN 1: NON_INV, PIN 2: INV...
    const comment1 = "PIN 1: IN+ | PIN 2: IN- | PIN 3: VCC | PIN 4: VEE | PIN 5: OUT";
    const pins1 = extractPinNamesFromHeaderComments(comment1, 5);
    expect(pins1).toEqual(["IN+", "IN-", "VCC", "VEE", "OUT"]);

    // Formato 2: CONNECTIONS: NON_INV INV VCC VEE OUT
    const comment2 = "CONNECTIONS: NON_INV INV VPOS VNEG OUTPUT";
    const pins2 = extractPinNamesFromHeaderComments(comment2, 5);
    expect(pins2).toEqual(["NON_INV", "INV", "VPOS", "VNEG", "OUTPUT"]);
  });

  it("sustituye pines numéricos genéricos por los extraídos de comentarios de cabecera", () => {
    const rawSpice = `
* PIN 1: IN_P
* PIN 2: IN_N
* PIN 3: VCC_P
* PIN 4: VEE_N
* PIN 5: VOUT
.SUBCKT LM741_NUMERIC 1 2 3 4 5
R1 1 2 2Meg
.ENDS LM741_NUMERIC
    `;

    const result = parseSpiceLibrary(rawSpice);
    expect(result.subcircuits).toHaveLength(1);
    const sub = result.subcircuits[0];
    expect(sub.pinNames).toEqual(["IN_P", "IN_N", "VCC_P", "VEE_N", "VOUT"]);
    expect(sub.pinLabels[0]).toBe("IN_P");
    expect(sub.pinLabels[4]).toBe("VOUT");
  });

  it("evalúa expresiones aritméticas SPICE y directivas .PARAM con sufijos de ingeniería", () => {
    const expr1 = evaluateSpiceExpression("{2 * R1 + 5k}", { R1: 1000 });
    expect(expr1).toBe(7000);

    const expr2 = evaluateSpiceExpression("{1 / (2 * PI * 1k * 10n)}");
    expect(expr2).toBeCloseTo(15915.49, 1);

    const expr3 = evaluateSpiceExpression("{sqrt(100) + pow(2, 3)}");
    expect(expr3).toBe(18);

    const expr4 = evaluateSpiceExpression("{ln(exp(3)) + sin(PI / 2)}");
    expect(expr4).toBeCloseTo(4, 5);

    const netlistWithParams = `
.PARAM R_BASE=1k MULT=4
.PARAM R_TOTAL={R_BASE * MULT + 500}
R1 IN OUT {R_TOTAL}
C1 OUT 0 {10u / MULT}
    `;

    const evaluated = evaluateSpiceParamExpressions(netlistWithParams);
    expect(evaluated.params["R_BASE"]).toBe(1000);
    expect(evaluated.params["MULT"]).toBe(4);
    expect(evaluated.params["R_TOTAL"]).toBe(4500);
    expect(evaluated.netlist).toContain("R1 IN OUT 4500");
    expect(evaluated.netlist).toContain("C1 OUT 0 0.0000025");
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
    expect(d1n4148.category).toBe("Diodos");
    expect(d1n4148.parameters?.["IS"]).toBeCloseTo(2.52e-9);
    expect(d1n4148.parameters?.["RS"]).toBeCloseTo(0.568);
    expect(d1n4148.parameters?.["N"]).toBeCloseTo(1.752);
    expect(d1n4148.parameters?.["CJO"]).toBeCloseTo(4e-12);
  });

  it("parsea modelos de transistores BJT y MOSFET con parámetros completos", () => {
    const spice = `
      * Transistor NPN 2N2222
      .MODEL 2N2222 NPN (IS=14.34f BF=255.9 VAF=74.03 RB=10 RC=1 CJC=7.306p CJE=22.01p)
      * MOSFET NMOS IRF540
      .MODEL IRF540 NMOS (VTO=3.5 KP=20.0 RD=0.044 CGSO=1.5n CGDO=200p)
    `;

    const result = parseSpiceLibrary(spice);
    expect(result.models).toHaveLength(2);

    const bjt = result.models[0];
    expect(bjt.name).toBe("2N2222");
    expect(bjt.type).toBe("npn");
    expect(bjt.category).toBe("Transistores");
    expect(bjt.parameters?.["IS"]).toBeCloseTo(14.34e-15);
    expect(bjt.parameters?.["BF"]).toBeCloseTo(255.9);
    expect(bjt.parameters?.["VAF"]).toBeCloseTo(74.03);

    const mosfet = result.models[1];
    expect(mosfet.name).toBe("IRF540");
    expect(mosfet.type).toBe("nmos");
    expect(mosfet.category).toBe("Transistores");
    expect(mosfet.parameters?.["VTO"]).toBeCloseTo(3.5);
    expect(mosfet.parameters?.["RD"]).toBeCloseTo(0.044);
  });

  it("maneja archivos vacíos o sin subcircuitos", () => {
    const result = parseSpiceLibrary("* Solo comentarios\n* Sin directivas");
    expect(result.subcircuits).toEqual([]);
    expect(result.models).toEqual([]);
  });
});
