import { describe, test, expect } from "vitest";
import { classifySimulationError } from "./simulation-error";

describe("classifySimulationError", () => {
  test("clasifica singular matrix error", () => {
    const raw = "matrix is singular at node N$3";
    const res = classifySimulationError(raw);
    expect(res.kind).toBe("singular-matrix");
    expect(res.suspectedComponentOrNetId).toBe("N$3");
    expect(res.userMessage).toContain("matriz singular");
  });

  test("clasifica iteration limit exceeded", () => {
    const raw = "Newton-Raphson iteration limit reached on diode D1";
    const res = classifySimulationError(raw);
    expect(res.kind).toBe("max-iterations-exceeded");
    expect(res.suspectedComponentOrNetId).toBe("D1");
    expect(res.userMessage).toContain("límite de 100 iteraciones");
  });

  test("clasifica convergence failure", () => {
    const raw = "Newton-Raphson convergence failed on diode D1";
    const res = classifySimulationError(raw);
    expect(res.kind).toBe("convergence-failure");
    expect(res.suspectedComponentOrNetId).toBe("D1");
    expect(res.userMessage).toContain("no convergió");
  });

  test("clasifica missing ground", () => {
    const raw = "invalid netlist: missing ground reference node";
    const res = classifySimulationError(raw);
    expect(res.kind).toBe("invalid-circuit");
    expect(res.userMessage).toContain("referencia a tierra");
  });

  test("clasifica unknown error", () => {
    const raw = "some weird error message";
    const res = classifySimulationError(raw);
    expect(res.kind).toBe("unknown");
    expect(res.userMessage).toContain("no reconocido");
  });

  test("clasifica estructurado singular matrix", () => {
    const err = {
      kind: "SingularMatrix",
      details: {
        message: "Matriz singular detectada.",
        node: "N$2"
      }
    };
    const res = classifySimulationError(err);
    expect(res.kind).toBe("singular-matrix");
    expect(res.suspectedComponentOrNetId).toBe("N$2");
    expect(res.userMessage).toBe("Matriz singular detectada.");
  });

  test("clasifica estructurado max iterations exceeded", () => {
    const err = {
      kind: "MaxIterationsExceeded",
      details: {
        message: "Límite de iteraciones alcanzado.",
        component: "R5"
      }
    };
    const res = classifySimulationError(err);
    expect(res.kind).toBe("max-iterations-exceeded");
    expect(res.suspectedComponentOrNetId).toBe("R5");
    expect(res.userMessage).toBe("Límite de iteraciones alcanzado.");
  });
});
