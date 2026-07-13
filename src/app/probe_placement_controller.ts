import type { OscilloscopePanel } from "../ui/oscilloscope_panel";

export type ProbeChannel = "CH1" | "CH2" | "CH3" | "CH4";

export interface ProbeNodes {
  ch1: string | null;
  ch2: string | null;
  ch3: string | null;
  ch4: string | null;
}

export interface ProbePlacementController {
  getMode(): ProbeChannel | null;
  setMode(channel: ProbeChannel): void;
  clearMode(): void;
  getNodes(): ProbeNodes;
  setNodes(nodes: ProbeNodes): void;
  getNode(channel: ProbeChannel): string | null;
  placeProbe(channel: ProbeChannel, nodeId: string): string;
}

export interface ProbePlacementControllerDeps {
  getOscilloscopePanel(): OscilloscopePanel | null;
}

const DEFAULT_PROBE_NODES: ProbeNodes = {
  ch1: "1",
  ch2: "2",
  ch3: "3",
  ch4: "4",
};

function probeKey(channel: ProbeChannel): keyof ProbeNodes {
  return channel.toLowerCase() as keyof ProbeNodes;
}

function channelIndex(channel: ProbeChannel): number {
  return Number(channel.replace("CH", ""));
}

function channelColor(channel: ProbeChannel): string {
  switch (channel) {
    case "CH1":
      return "Cian";
    case "CH2":
      return "Morada";
    case "CH3":
      return "Naranja";
    case "CH4":
      return "Verde";
  }
}

export function createProbePlacementController(
  deps: ProbePlacementControllerDeps,
): ProbePlacementController {
  let mode: ProbeChannel | null = null;
  let nodes: ProbeNodes = { ...DEFAULT_PROBE_NODES };

  const syncOscilloscopePanel = (): void => {
    const panel = deps.getOscilloscopePanel();
    if (!panel) return;

    panel.ch1ProbeNode = nodes.ch1;
    panel.ch2ProbeNode = nodes.ch2;
    panel.ch3ProbeNode = nodes.ch3;
    panel.ch4ProbeNode = nodes.ch4;
  };

  return {
    getMode: () => mode,
    setMode: (channel) => {
      mode = channel;
    },
    clearMode: () => {
      mode = null;
    },
    getNodes: () => ({ ...nodes }),
    setNodes: (nextNodes) => {
      nodes = { ...nextNodes };
      syncOscilloscopePanel();
    },
    getNode: (channel) => nodes[probeKey(channel)],
    placeProbe: (channel, nodeId) => {
      nodes = { ...nodes, [probeKey(channel)]: nodeId };
      syncOscilloscopePanel();
      return `Sonda del Canal ${channelIndex(channel)} (${channelColor(channel)}) conectada al Nodo ${nodeId}.`;
    },
  };
}
