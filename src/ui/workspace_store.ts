import { createWorkspaceTab, type InitialTabData, type Tab } from "./workspace_state";

export class WorkspaceStore {
  private readonly workspaceTabs: Tab[] = [];
  private currentTabId: string | null = null;

  public getTabs(): Tab[] {
    return this.workspaceTabs;
  }

  public getActiveTabId(): string | null {
    return this.currentTabId;
  }

  public setActiveTabId(tabId: string | null): void {
    this.currentTabId = tabId;
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

  public createTab(id: string, name?: string, initialData?: InitialTabData): Tab {
    const tabName = name || `Circuito ${this.workspaceTabs.length + 1}`;
    const tab = createWorkspaceTab(id, tabName, initialData);
    this.workspaceTabs.push(tab);
    return tab;
  }

  public indexOf(tabId: string): number {
    return this.workspaceTabs.findIndex(tab => tab.id === tabId);
  }

  public removeTab(tabId: string): { removed: Tab; index: number } | null {
    const index = this.indexOf(tabId);
    if (index === -1) return null;

    const [removed] = this.workspaceTabs.splice(index, 1);
    return { removed, index };
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
    return true;
  }
}
