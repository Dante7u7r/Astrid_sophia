import type { AnalysisMode } from "./simulation_controls";
import type { Tab } from "./workspace_state";
import { createWorkspaceTab } from "./workspace_state";

export const WORKSPACE_SESSION_STORAGE_KEY = "astryd_workspace_session_v1";

export interface SerializedTabSession {
  id: string;
  name: string;
  filePath: string | null;
  unsaved: boolean;
  activeAnalysisMode: AnalysisMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  components: any[];
  wires: any[];
  ch1ProbeNode: string | null;
  ch2ProbeNode: string | null;
  ch3ProbeNode: string | null;
  ch4ProbeNode: string | null;
  sparPorts: Array<{ nodeId: string; z0: number }>;
}

export interface SerializedWorkspaceSession {
  version: 1;
  timestamp: number;
  activeTabId: string | null;
  tabs: SerializedTabSession[];
}

export function saveWorkspaceSession(
  tabs: readonly Tab[],
  activeTabId: string | null,
  storage: Storage = localStorage,
): boolean {
  if (!storage || typeof storage.setItem !== "function") return false;

  try {
    const serializedTabs: SerializedTabSession[] = tabs.map(t => ({
      id: t.id,
      name: t.name,
      filePath: t.filePath,
      unsaved: t.unsaved,
      activeAnalysisMode: t.activeAnalysisMode,
      zoom: Number.isFinite(t.zoom) && t.zoom > 0 ? t.zoom : 1.0,
      offsetX: Number.isFinite(t.offsetX) ? t.offsetX : 0,
      offsetY: Number.isFinite(t.offsetY) ? t.offsetY : 0,
      components: t.components || [],
      wires: t.wires || [],
      ch1ProbeNode: t.ch1ProbeNode,
      ch2ProbeNode: t.ch2ProbeNode,
      ch3ProbeNode: t.ch3ProbeNode,
      ch4ProbeNode: t.ch4ProbeNode,
      sparPorts: t.sparPorts || [],
    }));

    const session: SerializedWorkspaceSession = {
      version: 1,
      timestamp: Date.now(),
      activeTabId,
      tabs: serializedTabs,
    };

    storage.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch (err) {
    console.warn("[WorkspaceSessionPersister] Error al guardar sesión automática:", err);
    return false;
  }
}

export function restoreWorkspaceSession(
  defaultAnalysisMode: AnalysisMode = "TRAN",
  storage: Storage = localStorage,
): { tabs: Tab[]; activeTabId: string | null } | null {
  if (!storage || typeof storage.getItem !== "function") return null;

  try {
    const raw = storage.getItem(WORKSPACE_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SerializedWorkspaceSession;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }

    const tabs: Tab[] = parsed.tabs.map(st => {
      const tab = createWorkspaceTab(
        st.id,
        st.name,
        {
          components: Array.isArray(st.components) ? st.components : [],
          wires: Array.isArray(st.wires) ? st.wires : [],
          filePath: st.filePath ?? null,
        },
        st.activeAnalysisMode || defaultAnalysisMode,
      );

      tab.unsaved = Boolean(st.unsaved);
      tab.zoom = Number.isFinite(st.zoom) && st.zoom > 0 ? st.zoom : 1.0;
      tab.offsetX = Number.isFinite(st.offsetX) ? st.offsetX : 0;
      tab.offsetY = Number.isFinite(st.offsetY) ? st.offsetY : 0;
      tab.ch1ProbeNode = st.ch1ProbeNode ?? "1";
      tab.ch2ProbeNode = st.ch2ProbeNode ?? "2";
      tab.ch3ProbeNode = st.ch3ProbeNode ?? "3";
      tab.ch4ProbeNode = st.ch4ProbeNode ?? "4";
      tab.sparPorts = Array.isArray(st.sparPorts) ? st.sparPorts : [];
      return tab;
    });

    const activeTabId = parsed.activeTabId && tabs.some(t => t.id === parsed.activeTabId)
      ? parsed.activeTabId
      : (tabs[0]?.id ?? null);

    return { tabs, activeTabId };
  } catch (err) {
    console.warn("[WorkspaceSessionPersister] Error al restaurar sesión automática:", err);
    return null;
  }
}

export function clearWorkspaceSession(storage: Storage = localStorage): void {
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(WORKSPACE_SESSION_STORAGE_KEY);
  } catch {
    // Ignorar si storage no está disponible
  }
}
