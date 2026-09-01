// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitSynthesizerModal } from "./circuit_synthesizer_modal";

describe("circuit_synthesizer_modal", () => {
  let modal: CircuitSynthesizerModal;
  const mockInsert = vi.fn();
  const mockLog = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    mockInsert.mockReset().mockReturnValue(true);
    mockLog.mockReset();
    modal = new CircuitSynthesizerModal({
      onInsertCircuit: mockInsert,
      addLog: mockLog,
    });
  });

  afterEach(() => {
    modal.destroy();
    document.body.innerHTML = "";
  });

  it("crea el elemento modal en el DOM y alterna su estado open/close con accesibilidad", () => {
    const modalEl = document.getElementById("circuit-synthesizer-modal");
    expect(modalEl).toBeTruthy();
    expect(modalEl?.classList.contains("modal-overlay")).toBe(true);
    expect(modal.isOpen()).toBe(false);

    modal.open();
    expect(modal.isOpen()).toBe(true);
    expect(modalEl?.classList.contains("open")).toBe(true);
    expect(modalEl?.getAttribute("aria-hidden")).toBe("false");

    modal.close();
    expect(modal.isOpen()).toBe(false);
    expect(modalEl?.classList.contains("open")).toBe(false);
    expect(modalEl?.getAttribute("aria-hidden")).toBe("true");
  });

  it("cierra el modal al presionar la tecla Escape o el botón de cerrar", () => {
    modal.open();
    expect(modal.isOpen()).toBe(true);

    const closeBtn = document.getElementById("btn-close-synthesizer-modal") as HTMLButtonElement;
    closeBtn.click();
    expect(modal.isOpen()).toBe(false);

    modal.open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.isOpen()).toBe(false);
  });

  it("elimina el listener global y el DOM al destruirse", () => {
    modal.open();
    const closeSpy = vi.spyOn(modal, "close");

    modal.destroy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(document.getElementById("circuit-synthesizer-modal")).toBeNull();
  });

  it("cierra el modal al presionar Cancelar o al hacer clic en el backdrop", () => {
    modal.open();
    const cancelBtn = document.getElementById("btn-synth-cancel") as HTMLButtonElement;
    cancelBtn.click();
    expect(modal.isOpen()).toBe(false);

    modal.open();
    const modalEl = document.getElementById("circuit-synthesizer-modal")!;
    modalEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal.isOpen()).toBe(false);
  });

  it("actualiza parámetros y telemetría para todos los tipos de circuito", () => {
    modal.open();
    const typeSelect = document.getElementById("synth-circuit-type") as HTMLSelectElement;
    const paramsContainer = document.getElementById("synth-params-container")!;
    const telemetryContainer = document.getElementById("synth-telemetry-container")!;

    // 1. Sallen-Key
    expect(paramsContainer.innerHTML).toContain("synth-cutoff-freq");
    expect(telemetryContainer.innerHTML).toContain("Frecuencia Real");

    // 2. BJT
    typeSelect.value = "bjt_amp";
    typeSelect.dispatchEvent(new Event("change"));
    expect(paramsContainer.innerHTML).toContain("synth-bjt-vcc");
    expect(telemetryContainer.innerHTML).toContain("Punto Q Real");

    // 3. Zener
    typeSelect.value = "zener_reg";
    typeSelect.dispatchEvent(new Event("change"));
    expect(paramsContainer.innerHTML).toContain("synth-zen-vz");
    expect(telemetryContainer.innerHTML).toContain("Resistencia Serie RS");

    // 4. Timer 555
    typeSelect.value = "timer_555";
    typeSelect.dispatchEvent(new Event("change"));
    expect(paramsContainer.innerHTML).toContain("synth-555-freq");
    expect(telemetryContainer.innerHTML).toContain("Capacitor C");

    // 5. RF Attenuator
    typeSelect.value = "rf_attenuator";
    typeSelect.dispatchEvent(new Event("change"));
    expect(paramsContainer.innerHTML).toContain("synth-rf-att");
    expect(telemetryContainer.innerHTML).toContain("Topología");

    // 6. MCU Blink
    typeSelect.value = "mcu_blink";
    typeSelect.dispatchEvent(new Event("change"));
    expect(paramsContainer.innerHTML).toContain("synth-mcu-family");
    expect(telemetryContainer.innerHTML).toContain("Firmware:");
    expect(telemetryContainer.textContent).toContain("no incluido");
  });

  it("construye el paquete de circuito e invoca onInsertCircuit al pulsar Insertar", async () => {
    modal.open();
    const generateBtn = document.getElementById("btn-synth-generate") as HTMLButtonElement;
    expect(generateBtn).toBeTruthy();

    generateBtn.click();
    await Promise.resolve();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Sallen-Key"),
        circuit: expect.objectContaining({
          components: expect.any(Array),
          wires: expect.any(Array),
        }),
      }),
      true,
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("sintetizado"),
      "receive",
    );
    expect(modal.isOpen()).toBe(false);
  });

  it.each([false, undefined])("no anuncia éxito sin confirmación explícita (%s) y conserva parámetros para reintentar", async (result) => {
    mockInsert.mockReturnValueOnce(result);
    modal.open();
    const frequency = document.getElementById("synth-cutoff-freq") as HTMLInputElement;
    const generateBtn = document.getElementById("btn-synth-generate") as HTMLButtonElement;
    frequency.value = "2400";

    generateBtn.click();
    await Promise.resolve();

    expect(modal.isOpen()).toBe(true);
    expect(frequency.value).toBe("2400");
    expect(generateBtn.disabled).toBe(false);
    expect(document.getElementById("synth-telemetry-container")?.textContent).toContain("No se confirmó la inserción");
    expect(mockLog).not.toHaveBeenCalledWith(expect.any(String), "receive");
    expect(mockLog).toHaveBeenCalledWith(expect.any(String), "error");

    generateBtn.click();
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(modal.isOpen()).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("insertado"), "receive");
  });

  it("mantiene visible el error de una inserción rechazada y permite reintentar", async () => {
    mockInsert.mockRejectedValueOnce(new Error("Documento bloqueado"));
    modal.open();
    const generateBtn = document.getElementById("btn-synth-generate") as HTMLButtonElement;

    generateBtn.click();
    await Promise.resolve();

    expect(modal.isOpen()).toBe(true);
    expect(document.getElementById("synth-telemetry-container")?.textContent).toContain("Documento bloqueado");
    expect(generateBtn.disabled).toBe(false);
    expect(mockLog).not.toHaveBeenCalledWith(expect.any(String), "receive");

    generateBtn.click();
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(modal.isOpen()).toBe(false);
  });

  it("espera la confirmación asíncrona sin duplicar inserciones ni perder parámetros", async () => {
    let resolveInsertion!: (inserted: boolean) => void;
    mockInsert.mockReturnValueOnce(new Promise<boolean>((resolve) => { resolveInsertion = resolve; }));
    modal.open();
    const modalEl = document.getElementById("circuit-synthesizer-modal")!;
    const frequency = document.getElementById("synth-cutoff-freq") as HTMLInputElement;
    const generateBtn = document.getElementById("btn-synth-generate") as HTMLButtonElement;
    frequency.value = "2400";

    generateBtn.click();
    generateBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    modal.close();
    modal.open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockLog).not.toHaveBeenCalledWith(expect.any(String), "receive");
    expect(modal.isOpen()).toBe(true);
    expect(modalEl.getAttribute("aria-busy")).toBe("true");
    expect(generateBtn.disabled).toBe(true);
    expect(frequency.disabled).toBe(true);
    expect(frequency.value).toBe("2400");

    resolveInsertion(true);
    await Promise.resolve();

    expect(modal.isOpen()).toBe(false);
    expect(modalEl.hasAttribute("aria-busy")).toBe(false);
    expect(generateBtn.disabled).toBe(false);
    expect(frequency.disabled).toBe(false);
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("insertado"), "receive");
  });

  it("no publica un resultado pendiente después de destruir el modal", async () => {
    let resolveInsertion!: (inserted: boolean) => void;
    mockInsert.mockReturnValueOnce(new Promise<boolean>((resolve) => { resolveInsertion = resolve; }));
    modal.open();
    (document.getElementById("btn-synth-generate") as HTMLButtonElement).click();

    modal.destroy();
    resolveInsertion(true);
    await Promise.resolve();

    expect(document.getElementById("circuit-synthesizer-modal")).toBeNull();
    expect(mockLog).not.toHaveBeenCalled();
  });
});
