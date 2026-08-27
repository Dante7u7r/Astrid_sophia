// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioOrchestrator } from "./audio_orchestrator";

describe("AudioOrchestrator", () => {
  let orchestrator: AudioOrchestrator;
  let mockGainNode: any;
  let mockOscNode: any;
  let mockBufferSource: any;
  let mockAudioContext: any;

  beforeEach(() => {
    mockGainNode = {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockOscNode = {
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockBufferSource = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    };

    mockAudioContext = {
      state: "running",
      currentTime: 0,
      destination: {},
      createGain: vi.fn(() => mockGainNode),
      createOscillator: vi.fn(() => mockOscNode),
      createBuffer: vi.fn((_channels, length, sampleRate) => ({
        duration: length / sampleRate,
        getChannelData: vi.fn(() => new Float32Array(length)),
      })),
      createBufferSource: vi.fn(() => mockBufferSource),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    (window as any).AudioContext = vi.fn().mockImplementation(function (this: any) {
      return mockAudioContext;
    });
    orchestrator = new AudioOrchestrator();
  });

  it("actualiza y reproduce tonos en zumbadores (buzzers)", () => {
    orchestrator.updateBuzzer("buzzer1", 440, 0.8);
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    expect(mockOscNode.start).toHaveBeenCalled();

    orchestrator.stopBuzzer("buzzer1");
    expect(mockGainNode.gain.linearRampToValueAtTime).toHaveBeenCalled();
  });

  it("reproduce búferes PCM en altavoces dinámicos (speakers)", () => {
    const samples = [0.1, 0.5, 0.9, -0.2, -0.8];
    orchestrator.updateSpeakerPcmBuffer("spk1", samples, 44100, 1.0);

    expect(mockAudioContext.createBuffer).toHaveBeenCalledWith(1, 5, 44100);
    expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
    expect(mockBufferSource.start).toHaveBeenCalled();

    orchestrator.stopSpeaker("spk1");
    expect(mockGainNode.disconnect).toHaveBeenCalled();
  });

  it("silencia todos los canales con toggleMute()", () => {
    orchestrator.updateBuzzer("buzzer1", 1000, 0.5);
    const isMuted = orchestrator.toggleMute();
    expect(isMuted).toBe(true);
    expect(orchestrator.getMuted()).toBe(true);
  });
});
