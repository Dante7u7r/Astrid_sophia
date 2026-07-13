import type { Tab, TabManager } from "../ui/tab_manager";
import type { CircuitDocumentPort } from "./circuit_document_controller";

export interface FilePersistenceControllerDependencies {
  getTabManager(): TabManager | null;
  documentController: CircuitDocumentPort;
  addLog(text: string, type?: "system" | "send" | "receive" | "error"): void;
  invokeTauri<T>(cmd: string, args?: unknown): Promise<T>;
}

export function initFilePersistenceController(
  dependencies: FilePersistenceControllerDependencies,
): void {
  const getTabManagerOrNull = (): TabManager | null => dependencies.getTabManager();

  const btnNewCircuit = document.querySelector("#btn-new-circuit");
  if (btnNewCircuit) {
    btnNewCircuit.addEventListener("click", () => {
      getTabManagerOrNull()?.createNewTab();
    });
  }

  const demoSelect = document.querySelector("#btn-open-demo") as HTMLSelectElement | null;
  if (demoSelect) {
    demoSelect.addEventListener("change", async () => {
      const file = demoSelect.value;
      demoSelect.value = "";
      if (!file) return;

      const tabManager = getTabManagerOrNull();
      if (!tabManager) return;

      try {
        dependencies.addLog(`Cargando demo: ${file}...`, "system");
        const resp = await fetch(`/demos/${file}`);
        if (!resp.ok) {
          dependencies.addLog(`No se encontro la demo ${file}`, "error");
          return;
        }

        const content = await resp.text();
        const candidate = dependencies.documentController.validateCircuitFileForLoad(content);
        if (!candidate) return;

        const demoTab = tabManager.createNewTab(
          file.replace(".astryd", ""),
          { components: [], wires: [], filePath: null },
        );
        if (!demoTab) return;

        if (dependencies.documentController.deserializeCircuit(content, candidate)) {
          tabManager.applyLoadedFileToTab(demoTab.id, {
            name: file.replace(".astryd", ""),
            filePath: null,
            unsaved: false,
          });
          dependencies.addLog(`Demo [${file}] cargada correctamente.`, "receive");
        } else {
          await tabManager.closeTab(demoTab.id);
        }
      } catch (err) {
        dependencies.addLog(`Error al cargar demo: ${err}`, "error");
      }
    });
  }

  const btnOpenCircuit = document.querySelector("#btn-open-circuit");
  if (btnOpenCircuit) {
    btnOpenCircuit.addEventListener("click", async () => {
      const tabManager = getTabManagerOrNull();
      if (!tabManager) return;

      dependencies.addLog("Abriendo dialogo para cargar archivo esquematico...", "system");
      try {
        const result = await dependencies.invokeTauri<[string, string]>("open_circuit_file");
        if (!result || !Array.isArray(result)) return;

        const [filePath, content] = result;
        const candidate = dependencies.documentController.validateCircuitFileForLoad(content);
        if (!candidate) return;

        const currentTab = tabManager.getActiveTab();
        const isEmpty = currentTab && tabManager.isTabEmpty(currentTab);

        let tabToLoad: Tab;
        let createdTab: Tab | null = null;
        const filename = filePath.split(/[/\\]/).pop() || "esquematico.astryd";

        if (isEmpty && currentTab) {
          tabToLoad = currentTab;
        } else {
          createdTab = tabManager.createNewTab(
            filename,
            { components: [], wires: [], filePath: null },
          );
          if (!createdTab) return;
          tabToLoad = createdTab;
        }

        const success = dependencies.documentController.deserializeCircuit(content, candidate);
        if (success) {
          const loadedTab = tabManager.applyLoadedFileToTab(tabToLoad.id, {
            name: filename,
            filePath,
            unsaved: false,
          });
          dependencies.addLog(`Esquematico [${loadedTab?.name ?? filename}] cargado con exito.`, "receive");
        } else if (createdTab) {
          await tabManager.closeTab(createdTab.id);
        }
      } catch (err) {
        if (err !== "Operacion cancelada por el usuario") {
          dependencies.addLog(`Error al abrir esquematico: ${err}`, "error");
        } else {
          dependencies.addLog("Operacion de apertura cancelada.", "system");
        }
      }
    });
  }

  const btnSaveCircuit = document.querySelector("#btn-save-circuit");
  if (btnSaveCircuit) {
    btnSaveCircuit.addEventListener("click", () => {
      getTabManagerOrNull()?.saveCircuitDirect();
    });
  }
}
