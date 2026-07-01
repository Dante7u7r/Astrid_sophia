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

  constructor(container: HTMLElement, _callbacks: any) {
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
            <div>Freq Fund: <span id="fft-fund-freq" style="color: var(--cyan);">-- Hz</span></div>
            <div>THD: <span id="fft-thd-val" style="color: var(--purple);">-- %</span></div>
          </div>
        </div>

        <!-- Panel Derecho: Gráfico de Espectro (dB vs Freq) -->
        <div style="width: 75%; display: flex; flex-direction: column; overflow: hidden; background: rgba(2, 3, 8, 0.95);">
          <div style="height: 24px; padding: 4px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); background: rgba(0,0,0,0.2);">
            <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase;">Espectro de Potencia (dBv / Hz)</span>
          </div>
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
        if (this.canvas && this.canvas.parentElement) {
          this.canvas.width = this.canvas.parentElement.clientWidth;
          this.canvas.height = this.canvas.parentElement.clientHeight;
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

    const w = this.canvas.width;
    const h = this.canvas.height;
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

    // Llenar arrays reales e imaginarios
    for (let i = 0; i < n; i++) {
      re[i] = this.rawData[i].val;
      im[i] = 0;
    }

    // Ejecutar FFT
    this.runFft(re, im);

    // Calcular magnitudes (espectro de potencia en dB)
    const magnitudes = new Float64Array(n / 2);
    let maxMag = -Infinity;
    let peakIndex = 0;

    for (let i = 0; i < n / 2; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (n / 2);
      magnitudes[i] = mag;
      if (mag > maxMag && i > 0) {
        maxMag = mag;
        peakIndex = i;
      }
    }

    // Calcular métricas
    const peakFreq = peakIndex * (samplingFreq / n);
    const fundFreqEl = this.container.querySelector("#fft-fund-freq");
    if (fundFreqEl) {
      fundFreqEl.textContent = isNaN(peakFreq) ? "-- Hz" : `${peakFreq.toFixed(1)} Hz`;
    }

    // Distorsión Armónica Total (THD) aproximada
    let thd = 0;
    if (peakIndex > 0 && peakIndex * 2 < n / 2) {
      let harmonicsSum = 0;
      for (let h = 2; h <= 5; h++) {
        const idx = peakIndex * h;
        if (idx < n / 2) {
          harmonicsSum += magnitudes[idx] * magnitudes[idx];
        }
      }
      thd = Math.sqrt(harmonicsSum) / (magnitudes[peakIndex] || 1);
    }
    const thdEl = this.container.querySelector("#fft-thd-val");
    if (thdEl) {
      thdEl.textContent = thd > 0.001 ? `${(thd * 100).toFixed(2)} %` : "0.01 %";
    }

    // Dibujar gráfico
    this.ctx.strokeStyle = "rgba(91, 243, 228, 0.45)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();

    const dbMin = -60;
    const dbMax = 20;

    for (let i = 1; i < n / 2; i++) {
      const mag = magnitudes[i];
      const db = 20 * Math.log10(mag + 1e-6);

      // Mapear a píxeles
      const x = 50 + ((w - 60) * i) / (n / 2 - 1);
      const y = h - 20 - ((h - 40) * (db - dbMin)) / (dbMax - dbMin);

      if (i === 1) {
        this.ctx.moveTo(x, Math.max(10, Math.min(h - 20, y)));
      } else {
        this.ctx.lineTo(x, Math.max(10, Math.min(h - 20, y)));
      }
    }
    this.ctx.stroke();

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
          im[target] = u_re - t_im; // Correct butterfly sub
          
          const next_w_re = w_re * wlen_re - w_im * wlen_im;
          w_im = w_re * wlen_im + w_im * wlen_re;
          w_re = next_w_re;
        }
      }
    }
  }
}
