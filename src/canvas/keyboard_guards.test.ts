// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isTypingInFormField,
  installWebviewKeyGuards,
  installWebviewAutofillGuards,
  installWebviewContextMenuGuard,
} from "./keyboard_guards";

describe("keyboard_guards", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects when typing in form fields", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isTypingInFormField()).toBe(true);

    input.blur();
    expect(isTypingInFormField()).toBe(false);
  });

  it("sanitizes form fields in installWebviewAutofillGuards", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    installWebviewAutofillGuards();
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
  });

  it("prevents default on contextmenu event outside text selection", () => {
    installWebviewContextMenuGuard();
    const btn = document.createElement("button");
    document.body.appendChild(btn);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, "preventDefault");
    btn.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
  });
});
