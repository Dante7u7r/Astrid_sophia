import type { InstrumentCallbacks } from "./instrument_callbacks";
import { ensureCanvasDpr } from "./canvas_dpr";

/**
 * FftAnalyzerInstrument — Analizador de Espectro (FFT) en Tiempo Real
 */

export class FftAnalyzerInstrument {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // UI state
  private activeChannel: "CH1" | "CH2" = "CH1";
  private rawData: { time: number; val: number }[] = [];

  constructor(container: HTMLElement, _callbacks: InstrumentCallbacks) {
    this.container = container;
    this.render();
    this.initCanvas();
    this.bindEvents();
  }

  private render() {
    this.container.innerHTML = `
      <div style="display: flex; gap: 10px; height: 100%; font-family: var(--font-sans); overflow: hidden;">
        <!-- Panel Izquierdo: Controles -->
        <div style="width: 25%; background: rgba(0,0,0,0.4); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 12px; padding: 12px;">
          <h4 style="color: var(--cyan); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Analizador FFT</h4>
          
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: bold;">Canal de Entrada</label>
            <div style="display: flex; gap: 4px;">
              <button id="fft-src-ch1" class="btn-osc-mini active" style="flex-grow: 1; padding: 6px;" type="button">CH1</button>
              <button id="fft-src-ch2" class="btn-osc-mini" style="flex-grow: 1; padding: 6px;" type="button">CH2</button>
            </div>
          </div>

          <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-family: var(--font-mono); font-size: 0.68rem; display: flex; flex-direction: column; gap: 6px;">
            <div style="color: var(--text-muted); font-size: 0.62rem; text-transform: uppercase;">Métricas del Espectro</div>
      <div class="fft-analyzer-panel" style="display: flex; flex-direction: column; height: 100%; width: 100%; background: #030508; color: #fff; font-family: var(--font-sans); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle);">
        <!-- Top Toolbar -->
        <div style="height: 36px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); background: rgba(255,255,255,0.03);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; font-size: 0.8rem; color: var(--cyan); display: flex; align-items: center; gap: 4px;">
              📈 Analizador de Espectro FFT
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button id="fft-src-ch1" class="btn-osc-mini active">CH1</button>
            <button id="fft-src-ch2" class="btn-osc-mini">CH2</button>
          </div>
        </div>

        <!-- Main Workspace -->
        <div style="flex-grow: 1; display: flex; overflow: hidden;">
          <!-- Metrics Info Sidebar -->
          <div style="width: 130px; border-right: 1px solid var(--border-subtle); background: rgba(0,0,0,0.3); display: flex; flex-direction: column; padding: 8px; gap: 10px;">
            <div>
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Freq Fundamental</div>
              <div id="fft-fund-freq" style="font-size: 0.95rem; font-weight: bold; color: var(--cyan);">-- Hz</div>
            </div>
            <div>
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">THD Estimado</div>
              <div id="fft-thd-val" style="font-size: 0.95rem; font-weight: bold; color: #a855f7;">-- %</div>
            </div>
            <div>
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Pico Máximo</div>
              <div id="fft-peak-db" style="font-size: 0.85rem; font-weight: bold; color: #22c55e;">-- dB</div>
            </div>
          </div>

          <!-- Screen Canvas Display -->
          <div style="flex-grow: 1; position: relative;">
            <canvas id="fft-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
            <div class="osc-grid-overlay"></div>
          </div>
        </div>
      </div>
    `;
  }

  private initCanvas() {
    this.canvas = this.container.querySelector("#fft-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      const resize = () => {
        if (this.canvas && this.ctx) {
          ensureCanvasDpr(this.canvas, this.ctx);
          this.computeAndDraw();
        }
      };
      window.addEventListener("resize", resize);
      setTimeout(resize, 100);
    }
  }

  private bindEvents() {
    const btnCh1 = this.container.querySelector("#fft-src-ch1") as HTMLElement;
    const btnCh2 = this.container.querySelector("#fft-src-ch2") as HTMLElement;

    if (btnCh1 && btnCh2) {
      btnCh1.addEventListener("click", () => {
        btnCh1.classList.add("active");
        btnCh2.classList.remove("active");
        this.activeChannel = "CH1";
        this.computeAndDraw();
      });
      btnCh2.addEventListener("click", () => {
        btnCh2.classList.add("active");
        btnCh1.classList.remove("active");
        this.activeChannel = "CH2";
        this.computeAndDraw();
      });
    }
  }

  public setTimeData(channel1Data: { time: number; val: number }[], channel2Data: { time: number; val: number }[]) {
    this.rawData = this.activeChannel === "CH1" ? channel1Data : channel2Data;
    this.computeAndDraw();
  }

  private computeAndDraw() {
    if (!this.canvas || !this.ctx || this.rawData.length < 16) return;

    const { width: w, height: h } = ensureCanvasDpr(this.canvas, this.ctx);
    this.ctx.clearRect(0, 0, w, h);

    // 1. Obtener la potencia de 2 más cercana para FFT
    const length = this.rawData.length;
    let n = 16;
    while (n * 2 <= length && n * 2 <= 512) {
      n *= 2;
    }

    const re = new Float64Array(n);
    const im = new Float64Array(n);

    // Calcular el delta de tiempo promedio (dt)
    let totalDt = 0;
    for (let i = 1; i < n; i++) {
      totalDt += this.rawData[i].time - this.rawData[i - 1].time;
    }
    const dt = totalDt / (n - 1);
    const samplingFreq = 1 / dt;

    // Llenar arrays con Ventana de Hann para eliminar el fugado espectral (spectral leakage)
    for (let i = 0; i < n; i++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      re[i] = this.rawData[i].val * hann;
      im[i] = 0;
    }

    // Ejecutar FFT Radix-2
    this.runFft(re, im);

    // Calcular magnitudes (espectro en escala lineal y dB)
    const magnitudes = new Float64Array(n / 2);
    let maxMag = -Infinity;
    let peakIndex = 0;

    for (let i = 0; i < n / 2; i++) {
      const mag = (Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (n / 2)) * 2; // Correccion de amplitud Hann
      magnitudes[i] = mag;
      if (mag > maxMag && i > 0) {
        maxMag = mag;
        peakIndex = i;
      }
    }

    // Sub-bin Parabolic Interpolation para la frecuencia fundamental f0 exacta
    let delta = 0;
    if (peakIndex > 0 && peakIndex < n / 2 - 1) {
      const alpha = Math.log(magnitudes[peakIndex - 1] + 1e-12);
      const beta = Math.log(magnitudes[peakIndex] + 1e-12);
      const gamma = Math.log(magnitudes[peakIndex + 1] + 1e-12);
      const denom = alpha - 2 * beta + gamma;
      if (Math.abs(denom) > 1e-6) {
        delta = 0.5 * ((alpha - gamma) / denom);
      }
    }

    const exactPeakBin = peakIndex + delta;
    const peakFreq = exactPeakBin * (samplingFreq / n);

    const fundFreqEl = this.container.querySelector("#fft-fund-freq");
    if (fundFreqEl) {
      fundFreqEl.textContent = isNaN(peakFreq) ? "-- Hz" : `${peakFreq.toFixed(1)} Hz`;
    }

    // Identificación de armónicos (f0, 2f0, 3f0, 4f0, 5f0) y THD real
    const harmonics: { order: number; freq: number; mag: number; bin: number; x: number; y: number; color: string }[] = [];
    const dbMin = -60;
    const dbMax = 20;

    if (peakIndex > 0) {
      const colors = ["#66fcf1", "#a855f7", "#f97316", "#22c55e", "#eab308"];
      let harmonicsPowerSum = 0;

      for (let h = 1; h <= 5; h++) {
        const targetBin = Math.round(exactPeakBin * h);
        if (targetBin >= n / 2) break;

        // Búsqueda en ventana local de ±2 bins
        let localPeak = targetBin;
        let localMax = -Infinity;
        for (let k = Math.max(1, targetBin - 2); k <= Math.min(n / 2 - 1, targetBin + 2); k++) {
          if (magnitudes[k] > localMax) {
            localMax = magnitudes[k];
            localPeak = k;
          }
        }

        const hMag = magnitudes[localPeak];
        const hFreq = localPeak * (samplingFreq / n);
        const hDb = 20 * Math.log10(hMag + 1e-6);

        const hX = 50 + ((w - 60) * localPeak) / (n / 2 - 1);
        const hY = h - 20 - ((h - 40) * (hDb - dbMin)) / (dbMax - dbMin);

        harmonics.push({
          order: h,
          freq: hFreq,
          mag: hMag,
          bin: localPeak,
          x: hX,
          y: Math.max(15, Math.min(h - 25, hY)),
          color: colors[(h - 1) % colors.length],
        });

        if (h >= 2) {
          harmonicsPowerSum += hMag * hMag;
        }
      }

      const fundMag = magnitudes[peakIndex] || 1e-6;
      const thdVal = Math.sqrt(harmonicsPowerSum) / fundMag;
      const thdEl = this.container.querySelector("#fft-thd-val");
      if (thdEl) {
        thdEl.textContent = `${(thdVal * 100).toFixed(2)} %`;
      }
    }

    // Dibujar gráfico espectral
    this.ctx.strokeStyle = "rgba(91, 243, 228, 0.45)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();

    for (let i = 1; i < n / 2; i++) {
      const mag = magnitudes[i];
      const db = 20 * Math.log10(mag + 1e-6);

      const x = 50 + ((w - 60) * i) / (n / 2 - 1);
      const y = h - 20 - ((h - 40) * (db - dbMin)) / (dbMax - dbMin);

      if (i === 1) {
        this.ctx.moveTo(x, Math.max(10, Math.min(h - 20, y)));
      } else {
        this.ctx.lineTo(x, Math.max(10, Math.min(h - 20, y)));
      }
    }
    this.ctx.stroke();

    // Dibujar marcadores neón flotantes para los armónicos (f0, 2f0, 3f0...)
    for (const hItem of harmonics) {
      this.ctx.save();
      this.ctx.strokeStyle = hItem.color;
      this.ctx.setLineDash([2, 2]);
      this.ctx.beginPath();
      this.ctx.moveTo(hItem.x, hItem.y);
      this.ctx.lineTo(hItem.x, h - 20);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.fillStyle = hItem.color;
      this.ctx.beginPath();
      this.ctx.arc(hItem.x, hItem.y, 3, 0, Math.PI * 2);
      this.ctx.fill();

      const label = `${hItem.order === 1 ? "f0" : `${hItem.order}f0`}: ${hItem.freq.toFixed(0)}Hz`;
      this.ctx.font = "bold 8px var(--font-mono)";
      this.ctx.fillStyle = "#030508";
      const txtW = this.ctx.measureText(label).width;

      this.ctx.fillStyle = hItem.color;
      this.ctx.fillRect(hItem.x - txtW / 2 - 2, hItem.y - 12, txtW + 4, 10);
      this.ctx.fillStyle = "#030508";
      this.ctx.textAlign = "center";
      this.ctx.fillText(label, hItem.x, hItem.y - 4);
      this.ctx.restore();
    }

    // Dibujar textos del eje
    this.ctx.fillStyle = "var(--text-muted)";
    this.ctx.font = "8px var(--font-mono)";
    this.ctx.fillText("0 Hz", 50, h - 8);
    this.ctx.fillText(`${(samplingFreq / 2).toFixed(0)} Hz`, w - 50, h - 8);
    this.ctx.fillText("20 dB", 10, 20);
    this.ctx.fillText("-60 dB", 10, h - 24);
  }

  private runFft(re: Float64Array, im: Float64Array) {
    const n = re.length;
    if (n <= 1) return;

    let j = 0;
    for (let i = 0; i < n; i++) {
      if (i < j) {
        let temp = re[i]; re[i] = re[j]; re[j] = temp;
        temp = im[i]; im[i] = im[j]; im[j] = temp;
      }
      let m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const angle = -2 * Math.PI / len;
      const wlen_re = Math.cos(angle);
      const wlen_im = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let w_re = 1;
        let w_im = 0;
        for (let k = 0; k < len / 2; k++) {
          const u_re = re[i + k];
          const u_im = im[i + k];
          const target = i + k + len / 2;
          const t_re = re[target] * w_re - im[target] * w_im;
          const t_im = re[target] * w_im + im[target] * w_re;
          re[i + k] = u_re + t_re;
          im[i + k] = u_im + t_im;
          re[target] = u_re - t_re;
          im[target] = u_im - t_im; // Correct butterfly subtraction
          
          const next_w_re = w_re * wlen_re - w_im * wlen_im;
          w_im = w_re * wlen_im + w_im * wlen_re;
          w_re = next_w_re;
        }
      }
    }
  }
}
