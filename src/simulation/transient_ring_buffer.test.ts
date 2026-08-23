import { describe, expect, it } from "vitest";
import { TransientRingBuffer } from "./transient_ring_buffer";
import type { TimeStepResult } from "../ui/oscilloscope_panel";

function createMockSample(time: number, v1: number): TimeStepResult {
  return {
    time,
    nodeVoltages: { "1": v1, "0": 0 },
    branchCurrents: { "R1": v1 / 1000 },
  };
}

describe("TransientRingBuffer", () => {
  it("inicializa con la capacidad especificada y longitud 0", () => {
    const ring = new TransientRingBuffer(5);
    expect(ring.capacity).toBe(5);
    expect(ring.length).toBe(0);
    expect(ring.isFull).toBe(false);
    expect(ring.get(0)).toBeUndefined();
    expect(ring.getLatest()).toBeUndefined();
    expect(ring.getOldest()).toBeUndefined();
  });

  it("rechaza capacidades menores a 2", () => {
    expect(() => new TransientRingBuffer(1)).toThrow(RangeError);
    expect(() => new TransientRingBuffer(0)).toThrow(RangeError);
  });

  it("almacena muestras en orden cronológico hasta llenarse", () => {
    const ring = new TransientRingBuffer(3);
    ring.push(createMockSample(0.1, 1.0));
    ring.push(createMockSample(0.2, 2.0));

    expect(ring.length).toBe(2);
    expect(ring.isFull).toBe(false);
    expect(ring.get(0)?.time).toBe(0.1);
    expect(ring.get(1)?.time).toBe(0.2);
    expect(ring.getOldest()?.time).toBe(0.1);
    expect(ring.getLatest()?.time).toBe(0.2);
  });

  it("sobrescribe en anillo circular al superar la capacidad manteniendo orden lógico", () => {
    const ring = new TransientRingBuffer(3);
    ring.push(createMockSample(0.1, 1.0));
    ring.push(createMockSample(0.2, 2.0));
    ring.push(createMockSample(0.3, 3.0));
    expect(ring.isFull).toBe(true);

    // Añadir 4ta muestra -> debe expulsar 0.1 y contener [0.2, 0.3, 0.4]
    ring.push(createMockSample(0.4, 4.0));
    expect(ring.length).toBe(3);
    expect(ring.isFull).toBe(true);
    expect(ring.get(0)?.time).toBe(0.2);
    expect(ring.get(1)?.time).toBe(0.3);
    expect(ring.get(2)?.time).toBe(0.4);
    expect(ring.getOldest()?.time).toBe(0.2);
    expect(ring.getLatest()?.time).toBe(0.4);

    // Añadir 5ta muestra -> debe expulsar 0.2 y contener [0.3, 0.4, 0.5]
    ring.push(createMockSample(0.5, 5.0));
    expect(ring.length).toBe(3);
    expect(ring.get(0)?.time).toBe(0.3);
    expect(ring.get(1)?.time).toBe(0.4);
    expect(ring.get(2)?.time).toBe(0.5);

    const array = ring.toArray();
    expect(array.map(s => s.time)).toEqual([0.3, 0.4, 0.5]);
  });

  it("reinicia automáticamente si el tiempo retrocede", () => {
    const ring = new TransientRingBuffer(5);
    ring.push(createMockSample(1.0, 5.0));
    ring.push(createMockSample(2.0, 5.0));
    expect(ring.length).toBe(2);

    // Nueva simulación iniciada en t = 0.0
    ring.push(createMockSample(0.0, 1.0));
    expect(ring.length).toBe(1);
    expect(ring.get(0)?.time).toBe(0.0);
    expect(ring.getLatest()?.time).toBe(0.0);
  });

  it("soporta pushBatch y clear", () => {
    const ring = new TransientRingBuffer(4);
    ring.pushBatch([
      createMockSample(0.1, 1),
      createMockSample(0.2, 2),
      createMockSample(0.3, 3),
      createMockSample(0.4, 4),
      createMockSample(0.5, 5),
    ]);

    expect(ring.length).toBe(4);
    expect(ring.get(0)?.time).toBe(0.2);
    expect(ring.get(3)?.time).toBe(0.5);

    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.isFull).toBe(false);
    expect(ring.get(0)).toBeUndefined();
  });

  it("ejecuta downsampleNodeLttb directamente sobre el anillo circular", () => {
    const ring = new TransientRingBuffer(10);
    for (let i = 0; i < 10; i++) {
      ring.push(createMockSample(i * 0.1, Math.sin(i * 0.5)));
    }

    const downsampled = ring.downsampleNodeLttb("1", 5);
    expect(downsampled.length).toBe(5);
    expect(downsampled[0]?.x).toBe(0.0);
    expect(downsampled[downsampled.length - 1]?.x).toBeCloseTo(0.9);
  });
});
