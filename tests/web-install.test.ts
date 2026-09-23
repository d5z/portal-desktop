import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { InstallController, installPlatform } from "../web/install";
import { parseDeployment } from "../web/deployment";

function setup(standalone = false) {
  const display = Object.assign(new EventTarget(), { matches: standalone });
  const host = Object.assign(new EventTarget(), {
    navigator: { userAgent: "Chrome", platform: "Win32", maxTouchPoints: 0 },
    isSecureContext: true,
    matchMedia: () => display,
  });
  const controller = new InstallController(host as unknown as Window);
  const stop = controller.start();
  const offer = (outcome = "dismissed") => {
    const prompt = vi.fn(async () => {});
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      { prompt, userChoice: Promise.resolve({ outcome }) },
    );
    host.dispatchEvent(event);
    return { event, prompt };
  };
  return { host, controller, stop, offer, display };
}
it("retains an early install offer and consumes it only on user action", async () => {
  const { controller, offer, stop } = setup();
  const { event, prompt } = offer();
  expect(event.defaultPrevented).toBe(true);
  expect(controller.getSnapshot().available).toBe(true);
  expect(prompt).not.toHaveBeenCalled();
  expect(await controller.install()).toBe("dismissed");
  expect(await controller.install()).toBe("guide");
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().installed).toBe(false);
  stop();
});
it("reports installation only after the browser confirms it", async () => {
  const { controller, offer, host, stop } = setup();
  offer("accepted");
  expect(await controller.install()).toBe("accepted");
  expect(controller.getSnapshot().installed).toBe(false);
  host.dispatchEvent(new Event("appinstalled"));
  expect(controller.getSnapshot()).toEqual({
    installed: true,
    available: false,
    busy: false,
  });
  expect(await controller.install()).toBe("installed");
  stop();
});
it("recognizes standalone launch and detaches browser listeners on cleanup", () => {
  const { controller, display, stop, host } = setup(true);
  expect(controller.getSnapshot().installed).toBe(true);
  display.matches = false;
  display.dispatchEvent(new Event("change"));
  expect(controller.getSnapshot().installed).toBe(false);
  stop();
  host.dispatchEvent(new Event("appinstalled"));
  expect(controller.getSnapshot().installed).toBe(false);
});
it("prevents concurrent prompts and falls back when the browser rejects a prompt", async () => {
  const { controller, host, stop } = setup();
  let reject!: (reason: Error) => void;
  const prompt = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  host.dispatchEvent(
    Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    }),
  );
  const first = controller.install();
  expect(await controller.install()).toBe("busy");
  reject(new Error("No user activation"));
  expect(await first).toBe("guide");
  expect(controller.getSnapshot().busy).toBe(false);
  stop();
});
it("uses iOS instructions for iPad desktop mode and distinguishes desktop Safari", () => {
  expect(
    installPlatform({
      userAgent: "Safari",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
  ).toBe("ios");
  expect(
    installPlatform({
      userAgent: "Safari",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
  ).toBe("mac-safari");
  expect(
    installPlatform({
      userAgent: "Chrome Safari",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
  ).toBe("desktop");
  expect(
    installPlatform({
      userAgent: "Android Chrome",
      platform: "Linux",
      maxTouchPoints: 5,
    }),
  ).toBe("android");
});
it("ships opaque correctly sized install icons and a credential-free relative launch path", () => {
  const manifest = JSON.parse(
    readFileSync("web/public/manifest.webmanifest", "utf8"),
  );
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("./index.html#chat");
  expect(manifest.scope).toBe("./");
  for (const base of ["https://site.test/", "https://site.test/being/"]) {
    expect(
      new URL(manifest.start_url, base + "manifest.webmanifest").href,
    ).toBe(base + "index.html#chat");
  }
  for (const icon of manifest.icons) {
    const png = readFileSync("web/public/" + icon.src);
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const apple = readFileSync("web/public/icons/apple-touch-icon.png");
  expect(apple.readUInt32BE(16)).toBe(180);
});
it("validates public deployment settings without accepting credentials or insecure remote APIs", () => {
  expect(
    parseDeployment(
      { mode: "static", apiBase: "https://api.example.com/" },
      "https://site.test",
    ),
  ).toEqual({ mode: "static", apiBase: "https://api.example.com" });
  for (const apiBase of [
    "https://user:secret@api.test",
    "http://api.test",
    "https://api.test?token=secret",
    "javascript:alert(1)",
  ])
    expect(() =>
      parseDeployment({ mode: "static", apiBase }, "https://site.test"),
    ).toThrow();
});
