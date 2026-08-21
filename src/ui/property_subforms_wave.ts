import type { ComponentInstance } from "../canvas_orchestrator";
import { formatSpiceValue } from "../simulation/spice_value_parser";

export function toggleWaveFieldsVisibility(waveType: string): void {
  const gAmp = document.querySelector("#group-wave-amp") as HTMLElement | null;
  const gFreq = document.querySelector("#group-wave-freq") as HTMLElement | null;
  const gModFreq = document.querySelector("#group-wave-mod-freq") as HTMLElement | null;
  const gModIdx = document.querySelector("#group-wave-mod-index") as HTMLElement | null;
  const gPhase = document.querySelector("#group-wave-phase") as HTMLElement | null;
  const gOffset = document.querySelector("#group-wave-offset") as HTMLElement | null;
  const gDuty = document.querySelector("#group-wave-duty") as HTMLElement | null;
  const gRs = document.querySelector("#group-wave-rs") as HTMLElement | null;
  const lFreq = document.querySelector("#label-wave-freq") as HTMLElement | null;
  const gNomVal = document.querySelector("#group-comp-val") as HTMLElement | null;
  const gNomUnit = document.querySelector("#group-comp-unit") as HTMLElement | null;

  if (!gAmp || !gFreq) return;

  if (gRs) gRs.style.display = "flex";

  if (waveType === "dc") {
    gAmp.style.display = "none";
    gFreq.style.display = "none";
    if (gModFreq) gModFreq.style.display = "none";
    if (gModIdx) gModIdx.style.display = "none";
    if (gPhase) gPhase.style.display = "none";
    if (gOffset) gOffset.style.display = "none";
    if (gDuty) gDuty.style.display = "none";
    if (gNomVal) gNomVal.style.display = "flex";
    if (gNomUnit) gNomUnit.style.display = "flex";
  } else if (waveType === "am") {
    gAmp.style.display = "flex";
    gFreq.style.display = "flex";
    if (lFreq) lFreq.textContent = "Frecuencia Portadora fc (Hz)";
    if (gModFreq) gModFreq.style.display = "flex";
    if (gModIdx) gModIdx.style.display = "flex";
    if (gPhase) gPhase.style.display = "flex";
    if (gOffset) gOffset.style.display = "flex";
    if (gDuty) gDuty.style.display = "none";
  } else if (waveType === "sine" || waveType === "triangle") {
    gAmp.style.display = "flex";
    gFreq.style.display = "flex";
    if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
    if (gModFreq) gModFreq.style.display = "none";
    if (gModIdx) gModIdx.style.display = "none";
    if (gPhase) gPhase.style.display = "flex";
    if (gOffset) gOffset.style.display = "flex";
    if (gDuty) gDuty.style.display = "none";
  } else if (waveType === "square" || waveType === "pulse") {
    gAmp.style.display = "flex";
    gFreq.style.display = "flex";
    if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
    if (gModFreq) gModFreq.style.display = "none";
    if (gModIdx) gModIdx.style.display = "none";
    if (gPhase) gPhase.style.display = "none";
    if (gOffset) gOffset.style.display = "flex";
    if (gDuty) gDuty.style.display = "flex";
  } else if (waveType === "sawtooth") {
    gAmp.style.display = "flex";
    gFreq.style.display = "flex";
    if (lFreq) lFreq.textContent = "Frecuencia (Hz)";
    if (gModFreq) gModFreq.style.display = "none";
    if (gModIdx) gModIdx.style.display = "none";
    if (gPhase) gPhase.style.display = "none";
    if (gOffset) gOffset.style.display = "flex";
    if (gDuty) gDuty.style.display = "none";
  }
}

export function bindWaveSubformEvents(): void {
  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement | null;
  if (waveTypeSelect) {
    waveTypeSelect.addEventListener("change", () => {
      toggleWaveFieldsVisibility(waveTypeSelect.value);
    });
  }
}

export function updateWaveSubform(comp: ComponentInstance): void {
  const waveContainer = document.querySelector("#wave-properties-container") as HTMLElement | null;
  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement | null;
  const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement | null;
  const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement | null;
  const waveModFreqInput = document.querySelector("#prop-wave-mod-freq") as HTMLInputElement | null;
  const waveModIndexInput = document.querySelector("#prop-wave-mod-index") as HTMLInputElement | null;
  const wavePhaseInput = document.querySelector("#prop-wave-phase") as HTMLInputElement | null;
  const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement | null;
  const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement | null;
  const waveRsInput = document.querySelector("#prop-wave-rs") as HTMLInputElement | null;
  const waveAcMagInput = document.querySelector("#prop-wave-ac-mag") as HTMLInputElement | null;
  const waveAcPhaseInput = document.querySelector("#prop-wave-ac-phase") as HTMLInputElement | null;

  if (!waveContainer) return;

  if (comp.type === "vsource" || comp.type === "isource") {
    waveContainer.style.display = "flex";
    if (waveTypeSelect) waveTypeSelect.value = comp.waveType || "dc";
    if (waveAmpInput) waveAmpInput.value = (comp.amplitude !== undefined ? comp.amplitude : 5).toString();
    if (waveFreqInput) waveFreqInput.value = (comp.frequency !== undefined ? comp.frequency : 1000).toString();
    if (waveModFreqInput) waveModFreqInput.value = (comp.modFrequency !== undefined ? comp.modFrequency : 100).toString();
    if (waveModIndexInput) waveModIndexInput.value = (comp.modIndex !== undefined ? comp.modIndex : 0.8).toString();
    if (wavePhaseInput) wavePhaseInput.value = (comp.phase !== undefined ? comp.phase : 0).toString();
    if (waveOffsetInput) waveOffsetInput.value = (comp.offset !== undefined ? comp.offset : 0).toString();
    if (waveDutyInput) waveDutyInput.value = (comp.dutyCycle !== undefined ? comp.dutyCycle : 0.5).toString();
    if (waveRsInput) waveRsInput.value = (comp.sourceResistance !== undefined ? comp.sourceResistance : 0).toString();
    if (waveAcMagInput) waveAcMagInput.value = (comp.acMag !== undefined ? comp.acMag : 0).toString();
    if (waveAcPhaseInput) waveAcPhaseInput.value = (comp.acPhase !== undefined ? comp.acPhase : 0).toString();

    toggleWaveFieldsVisibility(waveTypeSelect ? waveTypeSelect.value : (comp.waveType || "dc"));
  } else if (comp.type !== "net_label") {
    waveContainer.style.display = "none";
  }
}

export function applyWaveSubform(
  selected: ComponentInstance,
  newVal: number,
  propValInput: HTMLInputElement | null,
  propValSlider: HTMLInputElement | null
): void {
  if (selected.type !== "vsource" && selected.type !== "isource") return;

  const waveTypeSelect = document.querySelector("#prop-wave-type") as HTMLSelectElement | null;
  const waveAmpInput = document.querySelector("#prop-wave-amp") as HTMLInputElement | null;
  const waveFreqInput = document.querySelector("#prop-wave-freq") as HTMLInputElement | null;
  const waveModFreqInput = document.querySelector("#prop-wave-mod-freq") as HTMLInputElement | null;
  const waveModIndexInput = document.querySelector("#prop-wave-mod-index") as HTMLInputElement | null;
  const wavePhaseInput = document.querySelector("#prop-wave-phase") as HTMLInputElement | null;
  const waveOffsetInput = document.querySelector("#prop-wave-offset") as HTMLInputElement | null;
  const waveDutyInput = document.querySelector("#prop-wave-duty") as HTMLInputElement | null;
  const waveRsInput = document.querySelector("#prop-wave-rs") as HTMLInputElement | null;
  const waveAcMagInput = document.querySelector("#prop-wave-ac-mag") as HTMLInputElement | null;
  const waveAcPhaseInput = document.querySelector("#prop-wave-ac-phase") as HTMLInputElement | null;

  if (waveTypeSelect) selected.waveType = waveTypeSelect.value;
  if (waveAmpInput) selected.amplitude = parseFloat(waveAmpInput.value) || 0;
  if (waveFreqInput) selected.frequency = parseFloat(waveFreqInput.value) || 1000;
  if (waveModFreqInput) selected.modFrequency = parseFloat(waveModFreqInput.value) || 100;
  if (waveModIndexInput) selected.modIndex = Math.max(0, Math.min(1, parseFloat(waveModIndexInput.value) || 0.8));
  if (wavePhaseInput) selected.phase = parseFloat(wavePhaseInput.value) || 0;
  if (waveOffsetInput) selected.offset = parseFloat(waveOffsetInput.value) || 0;
  if (waveDutyInput) selected.dutyCycle = parseFloat(waveDutyInput.value) || 0.5;
  if (waveRsInput) selected.sourceResistance = Math.max(0, parseFloat(waveRsInput.value) || 0);
  if (waveAcMagInput) selected.acMag = parseFloat(waveAcMagInput.value) || 0;
  if (waveAcPhaseInput) selected.acPhase = parseFloat(waveAcPhaseInput.value) || 0;

  if (selected.waveType === "dc") {
    selected.value = newVal;
    selected.offset = newVal;
  }
  if (propValInput) propValInput.value = formatSpiceValue(Number(selected.value) || 0);
  if (propValSlider) propValSlider.value = selected.value.toString();
}
