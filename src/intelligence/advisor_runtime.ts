import type { ERCResult } from "../simulation/simulation_dispatcher";
import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { AnalysisMode } from "../ui/simulation_controls";
import type { SimulationSettings } from "../ui/settings_modal";
import {
  evaluateAdvisor,
  type AdvisorRecommendation,
} from "./advisor";
import {
  recordRecommendationOutcome,
  recordRecommendationShown,
  type FeedbackRunHandle,
} from "../feedback/instrumentation";

interface AdvisorSettingsAdapter {
  getSettings(): SimulationSettings;
  setSettings(settings: SimulationSettings): void;
}

interface AppliedRecommendation {
  readonly recommendation: AdvisorRecommendation;
  readonly previous: SimulationSettings;
}

let adapter: AdvisorSettingsAdapter | null = null;
let currentRecommendations: readonly AdvisorRecommendation[] = [];
const applied = new Map<string, AppliedRecommendation>();

function disabledRuleIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem("astryd.advisor.disabledRules") ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function publish(): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("astryd-recommendations", {
    detail: currentRecommendations,
  }));
}

export function configureAdvisorRuntime(settingsAdapter: AdvisorSettingsAdapter): void {
  adapter = settingsAdapter;
}

export function evaluateSimulationAdvice(input: {
  analysis: AnalysisMode;
  netlist: CircuitNetlist;
  erc: ERCResult;
  settings: SimulationSettings;
  transientDuration: number;
  feedbackRun?: FeedbackRunHandle;
}): readonly AdvisorRecommendation[] {
  currentRecommendations = evaluateAdvisor(input, disabledRuleIds());
  for (const recommendation of currentRecommendations) {
    recordRecommendationShown(recommendation, input.feedbackRun);
  }
  publish();
  return currentRecommendations;
}

export function getCurrentRecommendations(): readonly AdvisorRecommendation[] {
  return currentRecommendations;
}

export function applyRecommendation(recommendationId: string): boolean {
  const recommendation = currentRecommendations.find((item) => item.recommendationId === recommendationId);
  if (!recommendation || !recommendation.settingsPatch || recommendation.safetyClass !== "reversible" || !adapter) {
    return false;
  }
  const previous = adapter.getSettings();
  const next = { ...previous, ...recommendation.settingsPatch };
  if (
    !(next.dt > 0)
    || !(next.tolerance > 0 && next.tolerance <= 1)
    || !Number.isInteger(next.maxIterations)
    || next.maxIterations < 1
    || next.maxIterations > 10_000
  ) {
    return false;
  }
  adapter.setSettings(next);
  applied.set(recommendationId, { recommendation, previous });
  recordRecommendationOutcome(recommendationId, "accepted", true);
  return true;
}

export function undoRecommendation(recommendationId: string): boolean {
  const entry = applied.get(recommendationId);
  if (!entry || !adapter) return false;
  adapter.setSettings(entry.previous);
  applied.delete(recommendationId);
  return true;
}

export function rejectRecommendation(recommendationId: string): void {
  recordRecommendationOutcome(recommendationId, "rejected", false);
}

export function setRuleDisabled(ruleId: string, disabled: boolean): void {
  const ids = disabledRuleIds();
  if (disabled) ids.add(ruleId);
  else ids.delete(ruleId);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("astryd.advisor.disabledRules", JSON.stringify([...ids].sort()));
  }
  currentRecommendations = currentRecommendations.filter((item) => !ids.has(item.ruleId));
  publish();
}
