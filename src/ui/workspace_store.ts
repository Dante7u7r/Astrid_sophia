import { createWorkspaceTab, type InitialTabData, type Tab } from "./workspace_state";
import type { AnalysisMode } from "./simulation_controls";

export type WorkspaceStoreEventType =
  | "tab-created"
  | "tab-activated"
  | "tab-removed"
  | "tab-modified"
  | "tabs-loaded"
  | "tabs-cleared";

export type WorkspaceStoreListener<T = unknown> = (data: T) => void;

export class WorkspaceStore {
  private readonly workspaceTabs: Tab[] = [];
  private currentTabId: string | null = null;
  private readonly _listeners = new Map<WorkspaceStoreEventType, Set<WorkspaceStoreListener<any>>>();

  // ========================================================================
  // REACTIVIDAD — Suscripciones tipadas a ciclo de vida del workspace
  // ========================================================================

  public subscribe<T = unknown>(
    event: WorkspaceStoreEventType,
    listener: WorkspaceStoreListener<T>,
  ): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit<T = unknown>(event: WorkspaceStoreEventType, data?: T): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[WorkspaceStore] Error en listener de ${event}:`, err);
        }
      }
    }
  }

  // ========================================================================
  // ACCESO Y MUTACIONES
  // ========================================================================

  public getTabs(): Tab[] {
    return this.workspaceTabs;
  }

  public getActiveTabId(): string | null {
    return this.currentTabId;
  }

  public setActiveTabId(tabId: string | null): void {
    const previous = this.currentTabId;
    this.currentTabId = tabId;
    if (previous !== tabId) {
      this.emit("tab-activated", { activeTabId: tabId, previousTabId: previous });
    }
  }

  public getActiveTab(): Tab | undefined {
    return this.findTab(this.currentTabId);
  }

  public findTab(tabId: string | null): Tab | undefined {
    if (!tabId) return undefined;
    return this.workspaceTabs.find(tab => tab.id === tabId);
  }

  public hasTab(tabId: string): boolean {
    return this.workspaceTabs.some(tab => tab.id === tabId);
  }

  public createTab(
    id: string,
    name?: string,
    initialData?: InitialTabData,
    defaultAnalysisMode?: AnalysisMode,
  ): Tab {
    const tabName = name || `Circuito ${this.workspaceTabs.length + 1}`;
    const tab = createWorkspaceTab(id, tabName, initialData, defaultAnalysisMode);
    this.workspaceTabs.push(tab);
    this.emit("tab-created", tab);
    return tab;
  }

  public indexOf(tabId: string): number {
    return this.workspaceTabs.findIndex(tab => tab.id === tabId);
  }

  public removeTab(tabId: string): { removed: Tab; index: number } | null {
    const index = this.indexOf(tabId);
    if (index === -1) return null;

    const [removed] = this.workspaceTabs.splice(index, 1);
    const result = { removed: removed!, index };
    this.emit("tab-removed", result);
    return result;
  }

  public getFallbackTabIdAfterRemoval(removedIndex: number): string | null {
    if (this.workspaceTabs.length === 0) return null;
    const nextActiveIdx = Math.max(0, removedIndex - 1);
    return this.workspaceTabs[nextActiveIdx]?.id ?? null;
  }

  public markActiveTabAsModified(): boolean {
    const currentTab = this.getActiveTab();
    if (!currentTab || currentTab.unsaved) return false;

    currentTab.unsaved = true;
    this.emit("tab-modified", currentTab);
    return true;
  }

  public loadTabs(tabs: Tab[], activeTabId?: string | null): void {
    this.workspaceTabs.length = 0;
    this.workspaceTabs.push(...tabs);
    this.currentTabId = activeTabId ?? (tabs[0]?.id ?? null);
    this.emit("tabs-loaded", this.workspaceTabs);
  }

  public clearTabs(): void {
    this.workspaceTabs.length = 0;
    this.currentTabId = null;
    this.emit("tabs-cleared", undefined);
  }
}
