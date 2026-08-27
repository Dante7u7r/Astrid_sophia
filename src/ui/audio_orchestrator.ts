interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioOrchestrator {
  private ctx: AudioContext | null = null;
  private activeBuzzers = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private activeSpeakers = new Map<string, { gain: GainNode; lastPlayTime: number }>();
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

  /**
   * Reproduce en tiempo real un búfer de muestras PCM procedentes de la simulación transitoria de un altavoz.
   */
  public updateSpeakerPcmBuffer(
    id: string,
    samples: readonly number[] | Float32Array,
    sampleRate: number = 44100,
    volume: number = 1.0,
  ) {
    this.initContext();
    if (!this.ctx || this.isMuted || samples.length === 0 || volume <= 0.005) {
      this.stopSpeaker(id);
      return;
    }

    const safeSampleRate = Math.max(8000, Math.min(96000, sampleRate));
    const audioBuffer = this.ctx.createBuffer(1, samples.length, safeSampleRate);
    const channelData = audioBuffer.getChannelData(0);

    // Normalización con limitador suave (tanh) para evitar saturación acústica digital
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      // Escalar tensión (ej. +/- 5V nominal a +/- 1.0 con compresión suave)
      channelData[i] = Math.tanh(v * 0.25);
    }

    let speaker = this.activeSpeakers.get(id);
    if (!speaker) {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.min(1.0, volume) * 0.3, this.ctx.currentTime);
      gain.connect(this.ctx.destination);
      speaker = { gain, lastPlayTime: this.ctx.currentTime };
      this.activeSpeakers.set(id, speaker);
    } else {
      speaker.gain.gain.setValueAtTime(Math.min(1.0, volume) * 0.3, this.ctx.currentTime);
    }

    const bufferSource = this.ctx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(speaker.gain);

    const startTime = Math.max(this.ctx.currentTime, speaker.lastPlayTime);
    bufferSource.start(startTime);
    speaker.lastPlayTime = startTime + audioBuffer.duration;
  }

  public stopSpeaker(id: string) {
    const speaker = this.activeSpeakers.get(id);
    if (speaker) {
      try {
        speaker.gain.disconnect();
      } catch (e) {}
      this.activeSpeakers.delete(id);
    }
  }

  public stopAll() {
    for (const id of Array.from(this.activeBuzzers.keys())) {
      this.stopBuzzer(id);
    }
    for (const id of Array.from(this.activeSpeakers.keys())) {
      this.stopSpeaker(id);
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
