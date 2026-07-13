import { AccessibleMenu } from "./accessible_menu";

export interface InstrumentationMenuIssue {
  componentId: string;
  type: "error" | "warning";
  message: string;
  pinIndex?: number;
}

export interface InstrumentationMenuErcResult {
  passed: boolean;
  warnings: readonly string[];
  errors: readonly string[];
  issues: InstrumentationMenuIssue[];
}

export interface InstrumentationMenuActions {
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleInstrumentCenter: () => void;
  runErc: () => InstrumentationMenuErcResult | null;
  openSettings: () => void;
  addLog: (text: string, type?: "system" | "send" | "receive" | "error") => void;
}

export function parseErcIssues(
  warnings: readonly string[],
  errors: readonly string[],
): InstrumentationMenuIssue[] {
  const issues: InstrumentationMenuIssue[] = [];

  for (const warning of warnings) {
    const compMatch = warning.match(/\[([a-zA-Z0-9_]+)\]/);
    if (!compMatch) continue;
    const pinMatch = warning.match(/terminal index (\d+)/);
    issues.push({
      componentId: compMatch[1],
      type: "warning",
      message: warning,
      pinIndex: pinMatch ? parseInt(pinMatch[1], 10) : undefined,
    });
  }

  for (const error of errors) {
    const compMatch = error.match(/\[([a-zA-Z0-9_,\s]+)\]/);
    if (!compMatch) continue;
    for (const componentId of compMatch[1].split(",").map(part => part.trim()).filter(Boolean)) {
      issues.push({ componentId, type: "error", message: error });
    }
  }

  return issues;
}

export function initInstrumentationMenu(actions: InstrumentationMenuActions): AccessibleMenu | null {
  const button = document.querySelector("#instruments-menu-btn") as HTMLButtonElement | null;
  const dropdown = document.querySelector("#instruments-dropdown") as HTMLElement | null;
  if (!button || !dropdown) return null;

  const menu = new AccessibleMenu(button, dropdown);

  dropdown.querySelector("#menu-toggle-left")?.addEventListener("click", actions.toggleLeftPanel);
  dropdown.querySelector("#menu-toggle-right")?.addEventListener("click", actions.toggleRightPanel);
  dropdown.querySelector("#menu-toggle-dock")?.addEventListener("click", actions.toggleInstrumentCenter);
  dropdown.querySelector("#menu-run-erc")?.addEventListener("click", () => {
    const result = actions.runErc();
    if (!result) return;

    if (result.passed) {
      actions.addLog("ERC completado exitosamente sin errores críticos.", "system");
    } else {
      actions.addLog(
        `ERC falló con ${result.errors.length} errores críticos. Chequee los halos pulsantes en el lienzo.`,
        "error",
      );
    }
  });
  dropdown.querySelector("#menu-settings")?.addEventListener("click", () => {
    menu.close(false);
    actions.openSettings();
  });

  return menu;
}
