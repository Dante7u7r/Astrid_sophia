// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleLogController } from "./console_log_controller";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ConsoleLogController", () => {
  it("registra logs en QA y DOM con timestamp", () => {
    document.body.innerHTML = `<section id="console-output"></section>`;
    const recordQaLog = vi.fn();
    const controller = createConsoleLogController({
      recordQaLog,
      now: () => new Date("2026-07-12T10:20:30.004"),
    });

    controller.init();
    controller.addLog("Sistema listo", "system");

    expect(recordQaLog).toHaveBeenCalledWith("Sistema listo", "system");
    expect(document.querySelector("#console-output")?.textContent).toBe("[10:20:30.004] Sistema listo");
  });

  it("limpia la consola desde el boton", () => {
    document.body.innerHTML = `
      <button id="clear-console-btn"></button>
      <section id="console-output"><div>viejo</div></section>
    `;
    const controller = createConsoleLogController({
      recordQaLog: vi.fn(),
      now: () => new Date("2026-07-12T10:20:30.004"),
    });

    controller.init();
    controller.bindClearButton();
    document.querySelector<HTMLButtonElement>("#clear-console-btn")!.click();

    expect(document.querySelector("#console-output")?.textContent).toContain("Consola limpia");
  });
});
