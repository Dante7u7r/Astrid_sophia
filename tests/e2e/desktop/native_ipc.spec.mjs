function dividerNetlist() {
  return {
    components: [
      { id: "V1", type: "vsource", value: 5, pins: ["1", "0"] },
      {
        id: "R1",
        type: "resistor",
        value: 1_000,
        pins: ["1", "2"],
        tolerance: 0.1,
      },
      {
        id: "R2",
        type: "resistor",
        value: 1_000,
        pins: ["2", "0"],
        tolerance: 0.1,
      },
    ],
    wires: [],
  };
}

function spectralSamples() {
  const sampleRate = 1_024;
  const duration = 1;
  return Array.from({ length: sampleRate + 1 }, (_, index) => {
    const time = index / sampleRate;
    const voltage = Math.sin(2 * Math.PI * 64 * time)
      + 0.5 * Math.sin(2 * Math.PI * 96 * time);
    return {
      time,
      nodeVoltages: { "1": voltage },
      branchCurrents: {},
    };
  });
}

describe("contratos IPC nativos de escritorio", () => {
  before(async () => {
    await $("#circuit-canvas").waitForDisplayed({ timeout: 20_000 });
  });

  it("parsea SPICE y conserva el resultado numerico al resolverlo", async () => {
    const parsed = await browser.tauri.execute(
      (tauri, source) => tauri.core.invoke("parse_spice_netlist", { netlistStr: source }),
      [
        "V1 1 0 DC 5",
        "R1 1 2 1k",
        "R2 2 0 1k",
        ".end",
      ].join("\n"),
    );
    expect(parsed.components).toHaveLength(3);

    const result = await browser.tauri.execute(
      (tauri, netlist) => tauri.core.invoke("run_dc_simulation", { netlist }),
      parsed,
    );
    expect(result.errorLog).toBeNull();
    expect(result.convergenceIterations).toBeGreaterThan(0);
    expect(result.nodeVoltages["1"]).toBeCloseTo(5, 8);
    expect(result.nodeVoltages["2"]).toBeCloseTo(2.5, 8);
  });

  it("ejecuta barrido DC, solucion termica, ruido y Monte Carlo por IPC", async () => {
    const netlist = dividerNetlist();

    const sweep = await browser.tauri.execute(
      (tauri, nativeNetlist) => tauri.core.invoke("run_dc_sweep", {
        netlist: nativeNetlist,
        settings: {
          sourceId: "V1",
          vStart: 0,
          vEnd: 5,
          vStep: 1,
        },
      }),
      netlist,
    );
    expect(sweep.sweepVoltages).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sweep.nodeVoltages["2"]).toHaveLength(6);
    sweep.nodeVoltages["2"].forEach((voltage, index) => {
      expect(voltage).toBeCloseTo(index / 2, 8);
    });

    const thermal = await browser.tauri.execute(
      (tauri, nativeNetlist) => tauri.core.invoke("solve_dc_thermal", {
        netlist: nativeNetlist,
        tempK: 398.15,
      }),
      netlist,
    );
    expect(thermal.errorLog).toBeNull();
    expect(thermal.convergenceIterations).toBeGreaterThan(0);
    expect(thermal.nodeVoltages["2"]).toBeCloseTo(2.5, 6);

    const noise = await browser.tauri.execute(
      (tauri) => tauri.core.invoke("run_noise_sweep", {
        netlist: {
          components: [
            { id: "V1", type: "vsource", value: 0, pins: ["2", "0"] },
            { id: "R1", type: "resistor", value: 10_000, pins: ["2", "1"] },
          ],
          wires: [],
        },
        settings: {
          outputNode: "1",
          referenceNode: "0",
          acSettings: {
            fStart: 10,
            fEnd: 1_000,
            pointsPerDecade: 5,
            opGuess: null,
          },
        },
      }),
    );
    expect(noise.frequencies.length).toBeGreaterThan(5);
    for (const density of noise.outputNoiseDensity) {
      expect(density).toBeCloseTo(1.287159e-8, 10);
    }

    const monteCarlo = await browser.tauri.execute(
      (tauri, nativeNetlist) => tauri.core.invoke("run_monte_carlo_transient", {
        netlist: nativeNetlist,
        transientSettings: {
          dt: 0.0001,
          tMax: 0.0002,
          fixedStep: true,
          integrationMethod: "trapezoidal",
        },
        mcSettings: { runs: 5, seed: 123456 },
      }),
      netlist,
    );
    expect(monteCarlo).toHaveLength(5);
    for (const run of monteCarlo) {
      expect(run.length).toBeGreaterThan(0);
      const midpoint = run.at(-1).nodeVoltages["2"];
      expect(midpoint).toBeGreaterThan(2);
      expect(midpoint).toBeLessThan(3);
    }
  });

  it("calcula FFT, IMD y medidas atravesando la serializacion Tauri", async () => {
    const samples = spectralSamples();
    const fft = await browser.tauri.execute(
      (tauri, timeSteps) => tauri.core.invoke("run_fft_analysis", {
        timeSteps,
        nodeName: "1",
        fundamentalFreq: 64,
      }),
      samples,
    );
    expect(fft.frequencies.length).toBeGreaterThan(100);
    expect(Number.isFinite(fft.thd)).toBe(true);
    const strongestIndex = fft.magnitudesDb.reduce(
      (best, magnitude, index, magnitudes) => magnitude > magnitudes[best] ? index : best,
      1,
    );
    expect(fft.frequencies[strongestIndex]).toBeCloseTo(64, 0);

    const imd = await browser.tauri.execute(
      (tauri, timeSteps) => tauri.core.invoke("run_imd_analysis", {
        timeSteps,
        nodeName: "1",
        f1: 64,
        f2: 96,
      }),
      samples,
    );
    expect(imd.frequencies.length).toBeGreaterThan(100);
    expect(Number.isFinite(imd.imdRatioPercent)).toBe(true);
    expect(Number.isFinite(imd.ip3OutDbv)).toBe(true);

    const measures = await browser.tauri.execute(
      (tauri, timeSteps) => tauri.core.invoke("evaluate_measures", {
        timeSteps,
        directives: [
          {
            name: "v_peak",
            measureType: "peak",
            node: "1",
            trigNode: null,
            threshold: null,
            tStart: null,
            tEnd: null,
          },
          {
            name: "v_rms",
            measureType: "rms",
            node: "1",
            trigNode: null,
            threshold: null,
            tStart: null,
            tEnd: null,
          },
        ],
      }),
      samples,
    );
    expect(measures.errorLog).toBeNull();
    expect(measures.measurements.v_peak).toBeGreaterThan(1);
    expect(measures.measurements.v_peak).toBeLessThan(1.5);
    expect(measures.measurements.v_rms).toBeCloseTo(Math.sqrt(0.625), 2);
  });

  it("expande una linea de transmision y valida nombres camelCase", async () => {
    const components = await browser.tauri.execute(
      (tauri) => tauri.core.invoke("expand_transmission_line", {
        params: {
          id: "TL1",
          pinIn: "1",
          pinOut: "2",
          gnd: "0",
          z0: 50,
          td: 1e-9,
          rTotal: 2,
          gTotal: 0.000001,
          nSegments: 4,
        },
      }),
    );
    expect(components.length).toBeGreaterThanOrEqual(16);
    expect(components.some((component) => component.type === "inductor")).toBe(true);
    expect(components.some((component) => component.type === "capacitor")).toBe(true);
    expect(components.some((component) => component.type === "resistor")).toBe(true);
  });
});
