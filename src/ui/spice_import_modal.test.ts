// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { openSpiceImportModal } from "./spice_import_modal";

describe("SPICE import modal security", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("muestra nombres, comentarios y pines hostiles como texto sin crear nodos ejecutables", () => {
    openSpiceImportModal();

    const hostileName = "<img/src=x/onerror=alert(1)>";
    const hostilePin = "<svg/onload=alert(2)>";
    const hostileComment = "<script>alert(3)</script> descripción";
    const textarea = document.querySelector<HTMLTextAreaElement>("#spice-import-textarea");
    const analyzeButton = document.querySelector<HTMLButtonElement>("#btn-analyze-spice");

    expect(textarea).not.toBeNull();
    expect(analyzeButton).not.toBeNull();
    textarea!.value = `* ${hostileComment}\n.SUBCKT ${hostileName} ${hostilePin} OUT\nR1 ${hostilePin} OUT 1k\n.ENDS ${hostileName}`;
    analyzeButton!.click();

    const detectedList = document.querySelector<HTMLElement>("#spice-detected-list");
    expect(detectedList).not.toBeNull();
    expect(detectedList!.textContent).toContain(hostileName);
    expect(detectedList!.textContent).toContain(hostilePin);
    expect(detectedList!.textContent).toContain(hostileComment);
    expect(detectedList!.querySelector("img, script, svg, iframe, object, embed")).toBeNull();
    expect(detectedList!.querySelector("[onerror], [onload], [onclick]")).toBeNull();
  });
});
