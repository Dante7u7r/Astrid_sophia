interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioOrchestrator {
  private ctx: AudioContext | null = null;
  private activeBuzzers = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private isMuted = false;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public updateBuzzer(id: string, frequency: number, volume: number) {
    this.initContext();
    if (!this.ctx) return;

    if (this.isMuted || volume <= 0.01) {
      this.stopBuzzer(id);
      return;
    }

    const buzzer = this.activeBuzzers.get(id);
    const targetGain = volume * 0.15; // Limitar el volumen máximo para evitar molestias acústicas

    if (buzzer) {
      const now = this.ctx.currentTime;
      buzzer.osc.frequency.setValueAtTime(frequency, now);
      // Rampa lineal suave para evitar clics
      buzzer.gain.gain.setValueAtTime(buzzer.gain.gain.value, now);
      buzzer.gain.gain.linearRampToValueAtTime(targetGain, now + 0.03);
    } else {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth'; // Onda diente de sierra para un tono de zumbador realista
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);

      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(targetGain, this.ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();

      this.activeBuzzers.set(id, { osc, gain });
    }
  }

  public stopBuzzer(id: string) {
    const buzzer = this.activeBuzzers.get(id);
    if (!buzzer || !this.ctx) return;

    const now = this.ctx.currentTime;
    try {
      buzzer.gain.gain.setValueAtTime(buzzer.gain.gain.value, now);
      buzzer.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      
      const osc = buzzer.osc;
      const gn = buzzer.gain;
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
          gn.disconnect();
        } catch (e) {}
      }, 50);
    } catch (e) {}

    this.activeBuzzers.delete(id);
  }

  public stopAll() {
    for (const id of Array.from(this.activeBuzzers.keys())) {
      this.stopBuzzer(id);
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopAll();
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }
}
