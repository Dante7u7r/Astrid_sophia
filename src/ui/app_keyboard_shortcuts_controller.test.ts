// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initAppKeyboardShortcuts } from "./app_keyboard_shortcuts_controller";
import type { PanelLayoutManager } from "./panel_layout_manager";
import type { SidePanelController } from "./side_panel_controller";
import type { TabManager } from "./tab_manager";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("initAppKeyboardShortcuts", () => {
  it("redirige atajos principales a tabs, paneles y archivo", () => {
    const tabManager = {
      createNewTab: vi.fn(),
      saveCircuitDirect: vi.fn(),
      saveCircuitAs: vi.fn(),
      closeActiveTab: vi.fn(),
    } as unknown as TabManager;
    const sidePanelController = {
      toggleSidePanel: vi.fn(),
    } as unknown as SidePanelController;
    const panelLayoutManager = {
      togglePanel: vi.fn(),
    } as unknown as PanelLayoutManager;
    const openButton = document.createElement("button");
    const openClick = vi.spyOn(openButton, "click");

    initAppKeyboardShortcuts({
      getTabManager: () => tabManager,
      getPanelLayoutManager: () => panelLayoutManager,
      getSidePanelController: () => sidePanelController,
      isTypingInFormField: () => false,
      getOpenCircuitButton: () => openButton,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F9" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F10" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F8" }));

    expect(tabManager.createNewTab).toHaveBeenCalledOnce();
    expect(openClick).toHaveBeenCalledOnce();
    expect(tabManager.saveCircuitDirect).toHaveBeenCalledOnce();
    expect(tabManager.saveCircuitAs).toHaveBeenCalledOnce();
    expect(tabManager.closeActiveTab).toHaveBeenCalledOnce();
    expect(sidePanelController.toggleSidePanel).toHaveBeenNthCalledWith(1, "left");
    expect(sidePanelController.toggleSidePanel).toHaveBeenNthCalledWith(2, "right");
    expect(panelLayoutManager.togglePanel).toHaveBeenCalledWith("dock");
  });

  it("ignora comandos de app mientras se escribe", () => {
    const tabManager = {
      createNewTab: vi.fn(),
    } as unknown as TabManager;

    initAppKeyboardShortcuts({
      getTabManager: () => tabManager,
      getPanelLayoutManager: () => null,
      getSidePanelController: () => null,
      isTypingInFormField: () => true,
      getOpenCircuitButton: () => null,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }));

    expect(tabManager.createNewTab).not.toHaveBeenCalled();
  });

  it("abre la guía interactiva con F1", () => {
    const onOpenGuide = vi.fn();

    initAppKeyboardShortcuts({
      getTabManager: () => null,
      getPanelLayoutManager: () => null,
      getSidePanelController: () => null,
      isTypingInFormField: () => false,
      getOpenCircuitButton: () => null,
      onOpenGuide,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    expect(onOpenGuide).toHaveBeenCalledOnce();
  });

  it("abre el modal de feedback con F7 o Ctrl+Shift+B", () => {
    const onOpenFeedback = vi.fn();

    initAppKeyboardShortcuts({
      getTabManager: () => null,
      getPanelLayoutManager: () => null,
      getSidePanelController: () => null,
      isTypingInFormField: () => false,
      getOpenCircuitButton: () => null,
      onOpenFeedback,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7" }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(2);
  });

  it("activa el modo Zen / Pantalla Completa con F11 o Ctrl+Shift+F", () => {
    const onToggleZenMode = vi.fn();

    initAppKeyboardShortcuts({
      getTabManager: () => null,
      getPanelLayoutManager: () => null,
      getSidePanelController: () => null,
      isTypingInFormField: () => false,
      getOpenCircuitButton: () => null,
      onToggleZenMode,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11" }));
    expect(onToggleZenMode).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true }));
    expect(onToggleZenMode).toHaveBeenCalledTimes(2);
  });
});
