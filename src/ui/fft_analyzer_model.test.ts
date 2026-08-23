import { describe, expect, it } from "vitest";
import {
  applyWindowFunction,
  computeFftSpectrum,
  computeRadix2Fft,
  convertMagnitude,
  FFT_WINDOWS,
} from "./fft_analyzer_model";

describe("FftAnalyzerModel", () => {
  it("aplica correctamente las ventanas de ponderación espectral", () => {
    const data = new Float64Array([1, 1, 1, 1, 1, 1, 1, 1]);
    const { windowed: hann, coherentGain: gainHann } = applyWindowFunction(data, "hann");
    expect(gainHann).toBe(0.5);
    expect(hann[0]).toBeCloseTo(0.0, 4);
    expect(hann[hann.length - 1]).toBeCloseTo(0.0, 4);

    const { windowed: rect, coherentGain: gainRect } = applyWindowFunction(data, "rectangular");
    expect(gainRect).toBe(1.0);
    expect(rect[0]).toBe(1.0);
  });

  it("calcula la FFT Radix-2 de un tono senoidal puro y localiza su frecuencia fundamental", () => {
    const fs = 10000; // 10 kHz
    const f0 = 1000;  // 1 kHz
    const numPoints = 256;
    const samples: { time: number; val: number }[] = [];

    for (let i = 0; i < numPoints; i++) {
      const t = i / fs;
      const val = 5.0 * Math.sin(2 * Math.PI * f0 * t); // 5 Vpk -> 3.535 Vrms
      samples.push({ time: t, val });
    }

    const result = computeFftSpectrum(samples, "hann", 256);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.samplingFreq).toBeCloseTo(fs, 0);
    expect(result.fundamentalFreq).toBeCloseTo(1000, 0);
    expect(result.fundamentalVrms).toBeGreaterThan(3.0);
    expect(result.harmonics.length).toBeGreaterThanOrEqual(1);
    expect(result.harmonics[0].order).toBe(1);
  });

  it("detecta armónicos y calcula THD para una señal distorsionada", () => {
    const fs = 20000;
    const f0 = 1000;
    const numPoints = 512;
    const samples: { time: number; val: number }[] = [];

    for (let i = 0; i < numPoints; i++) {
      const t = i / fs;
      // Fundamental 5Vpk + 2º armónico 0.5Vpk (10% de distorsión)
      const val =
        5.0 * Math.sin(2 * Math.PI * f0 * t) +
        0.5 * Math.sin(2 * Math.PI * (2 * f0) * t);
      samples.push({ time: t, val });
    }

    const result = computeFftSpectrum(samples, "hann", 512);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.fundamentalFreq).toBeCloseTo(1000, 0);
    expect(result.thdPercent).toBeGreaterThan(8.0);
    expect(result.thdPercent).toBeLessThan(12.0);
    expect(result.harmonics.length).toBeGreaterThanOrEqual(2);
    expect(result.harmonics[1].order).toBe(2);
    expect(result.harmonics[1].freq).toBeGreaterThan(1950);
    expect(result.harmonics[1].freq).toBeLessThan(2050);
  });

  it("convierte magnitudes Vrms a diferentes escalas (dBV, dBm, Vpk)", () => {
    const vrms = 1.0; // 1 Vrms
    expect(convertMagnitude(vrms, "dbv").value).toBeCloseTo(0.0, 4);
    expect(convertMagnitude(vrms, "dbv").unit).toBe("dBV");

    expect(convertMagnitude(vrms, "dbm").value).toBeCloseTo(13.01, 1);
    expect(convertMagnitude(vrms, "dbm_50").value).toBeCloseTo(13.01, 1);

    // dBu: Ref 0.7746 Vrms -> 20 * log10(1 / 0.7746) = +2.218 dBu
    expect(convertMagnitude(vrms, "dbu").value).toBeCloseTo(2.218, 2);
    expect(convertMagnitude(vrms, "dbu").unit).toBe("dBu");

    // dBm(600Ω): Ref 1mW in 600Ω -> +2.218 dBm
    expect(convertMagnitude(vrms, "dbm_600").value).toBeCloseTo(2.218, 2);
    expect(convertMagnitude(vrms, "dbm_600").unit).toBe("dBm(600Ω)");

    expect(convertMagnitude(vrms, "linear_vpk").value).toBeCloseTo(Math.SQRT2, 4);
    expect(convertMagnitude(vrms, "linear_vpk").unit).toBe("Vpk");
  });

  it("calcula ENOB correctamente a partir de SINAD", () => {
    const fs = 10000;
    const f0 = 1000;
    const numPoints = 256;
    const samples: { time: number; val: number }[] = [];

    for (let i = 0; i < numPoints; i++) {
      const t = i / fs;
      samples.push({ time: t, val: 2.0 * Math.sin(2 * Math.PI * f0 * t) });
    }

    const result = computeFftSpectrum(samples, "hann", 256);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.enob).toBeDefined();
    expect(result.enob).toBeGreaterThan(5.0); // Tono sintético con SNR alto
  });
});
