// ==========================================================================
// BIAANI INTERACTIVE FEATURE TOUR — TIPOS Y CONTRATOS
// ==========================================================================

export type GuideTopicId =
  | "environment"
  | "schematic"
  | "simulation"
  | "instruments"
  | "advanced";

export type GuidePlacement = "top" | "bottom" | "left" | "right" | "center" | "auto";

export interface GuideTopic {
  id: GuideTopicId;
  title: string;
  icon: string;
  description: string;
}

export interface GuideStepActionButton {
  label: string;
  actionId: string;
  icon?: string;
}

export interface GuideStep {
  id: string;
  topicId: GuideTopicId;
  topicTitle: string;
  title: string;
  description: string;
  shortcut?: string;
  targetSelector?: string;
  placement?: GuidePlacement;
  actionHint?: string;
  requiresPanel?: "left" | "right" | "dock";
  requiresInstrumentTab?: string;
  actionButton?: GuideStepActionButton;
}

export interface GuideState {
  isActive: boolean;
  currentStepIndex: number;
  totalSteps: number;
  currentStep: GuideStep | null;
  currentTopic: GuideTopic | null;
}

export type GuideStateChangeListener = (state: GuideState) => void;

export interface GuideEngineDeps {
  onPanelOpenRequest?: (panel: "left" | "right" | "dock") => void;
  onInstrumentTabRequest?: (tabId: string) => void;
  onActionTrigger?: (actionId: string, step: GuideStep) => void;
  storage?: Storage;
}