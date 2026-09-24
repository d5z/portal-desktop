import { expect, it } from "vitest";
import { installWebViewport } from "../web/viewport";

function fixture(withVisualViewport = true) {
  const properties = new Map<string, string>();
  const root = {
    clientHeight: 844,
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  const textarea = { tagName: "TEXTAREA", matches: () => true };
  const doc = { documentElement: root, activeElement: {
    tagName: "IFRAME", contentDocument: { activeElement: textarea }, matches: () => false,
  } as unknown };
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const win = Object.assign(new EventTarget(), {
    document: doc, visualViewport: withVisualViewport ? viewport : null, innerHeight: 844, innerWidth: 390,
  });
  const dispose = installWebViewport(win as unknown as Window);
  return { win, root, doc, viewport, properties, dispose };
}

it.each(["visual", "inner", "layout"])("tracks keyboard opening and closing when %s viewport shrinks", mode => {
  const f = fixture();
  try {
    f.viewport.height = 450;
    f.viewport.offsetTop = 80;
    if (mode !== "visual") f.win.innerHeight = 450;
    if (mode === "layout") f.root.clientHeight = 450;
    f.viewport.dispatchEvent(new Event("resize"));
    expect(f.root.dataset.keyboard).toBe("true");
    expect(f.properties.get("--web-viewport-height")).toBe("450px");
    expect(f.properties.get("--web-viewport-offset")).toBe("80px");
    // Safari can pan to the focused input without another resize.
    f.viewport.offsetTop = 110;
    f.viewport.dispatchEvent(new Event("scroll"));
    expect(f.properties.get("--web-viewport-offset")).toBe("110px");
    // Dismissing the keyboard need not blur the textarea.
    f.viewport.height = f.win.innerHeight = f.root.clientHeight = 844;
    f.viewport.offsetTop = 0;
    f.viewport.dispatchEvent(new Event("resize"));
    expect(f.root.dataset.keyboard).toBe("false");
    expect(f.properties.get("--web-viewport-height")).toBe("844px");
    expect(f.properties.get("--web-viewport-offset")).toBe("0px");
  } finally { f.dispose(); }
});

it("does not mistake browser chrome, rotation, or pinch zoom for a keyboard", () => {
  const f = fixture();
  try {
    f.viewport.height = 780;
    f.viewport.dispatchEvent(new Event("resize"));
    expect(f.root.dataset.keyboard).toBe("false");
    f.viewport.scale = 2;
    f.viewport.height = 390;
    f.viewport.dispatchEvent(new Event("resize"));
    expect(f.root.dataset.keyboard).toBe("false");
    expect(f.properties.get("--web-viewport-height")).toBe("780px");
    f.viewport.scale = 1;
    f.win.innerWidth = 844;
    f.win.innerHeight = f.root.clientHeight = f.viewport.height = 390;
    f.win.dispatchEvent(new Event("resize"));
    expect(f.root.dataset.keyboard).toBe("false");
    expect(f.properties.get("--web-viewport-height")).toBe("390px");
  } finally { f.dispose(); }
});

it("allows window resizing without an editor and removes every listener on cleanup", () => {
  const f = fixture();
  f.doc.activeElement = { tagName: "BODY", matches: () => false };
  f.win.innerHeight = f.root.clientHeight = f.viewport.height = 400;
  f.win.dispatchEvent(new Event("resize"));
  expect(f.root.dataset.keyboard).toBe("false");
  f.dispose();
  f.viewport.dispatchEvent(new Event("resize"));
  f.viewport.dispatchEvent(new Event("scroll"));
  f.win.dispatchEvent(new Event("resize"));
  expect(f.properties.size).toBe(0);
  expect(f.root.dataset.keyboard).toBeUndefined();
});

it("uses window resize when VisualViewport is unavailable", () => {
  const f = fixture(false);
  try {
    f.win.innerHeight = 600;
    f.win.dispatchEvent(new Event("resize"));
    expect(f.properties.get("--web-viewport-height")).toBe("600px");
    expect(f.properties.get("--web-viewport-offset")).toBe("0px");
  } finally { f.dispose(); }
});
