import { expect, it, vi } from "vitest";
import { WebTownPairing } from "../web/auto-pair";
import { parseWebConnection } from "../web/connection";

const id = "11111111-2222-4333-8444-555555555555";
function fixture(stall = false, timeoutMs = 90000) {
  let connection = parseWebConnection(
    "https://being.test/willow?token=loom-fixture",
  );
  let generation = 0;
  const save = vi.fn();
  const pair = vi.fn(async () => ({
    token: "town-fixture",
    beingId: "t_Willow",
    display: "柳树",
  }));
  const fetcher = vi.fn(
    async () =>
      new Response(
        stall
          ? new ReadableStream()
          : 'event: text\ndata: {"text":"AB3XY9"}\n\nevent: message_stop\ndata: {}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  const pairing = new WebTownPairing({
    connection: () => connection,
    resolve: async (value) => ({ ...value, api: "https://web.test/loom-api" }),
    generation: () => generation,
    pair,
    save,
    fetcher,
    timeoutMs,
  });
  return {
    pairing,
    save,
    pair,
    fetcher,
    changeBeing: () => {
      connection = parseWebConnection("https://being.test/river?token=other");
    },
    changeTown: () => {
      generation++;
    },
  };
}
it("requests a code through the configured web transport and saves only confirmed Town credentials", async () => {
  const f = fixture();
  await f.pairing.start({ requestId: id, beingId: "willow" });
  const call = (f.fetcher.mock.calls as unknown as [string, RequestInit][])[0];
  expect(call[0]).toBe(
    "https://web.test/loom-api/api/chat/stream?token=loom-fixture",
  );
  expect(JSON.parse(String(call[1].body)).scene_meta.client).toBe("town-web");
  expect(f.pair).toHaveBeenCalledWith(
    { beingId: "willow", code: "AB3XY9" },
    expect.any(AbortSignal),
  );
  expect(f.save).toHaveBeenCalledWith({
    token: "town-fixture",
    beingId: "t_Willow",
    display: "柳树",
  });
});
it("cancels a stalled stream and rejects duplicate automatic pairing", async () => {
  const f = fixture(true);
  const pending = f.pairing.start({ requestId: id, beingId: "willow" });
  const rejected = expect(pending).rejects.toThrow("取消");
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalled());
  await expect(
    f.pairing.start({ requestId: id, beingId: "willow" }),
  ).rejects.toThrow("正在配对");
  f.pairing.cancel(id);
  await rejected;
  expect(f.pair).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it.each(["Being", "Town", "cancel"])(
  "discards late confirmation when %s changes",
  async (mode) => {
    const f = fixture();
    let finish!: (value: {
      token: string;
      beingId: string;
      display: string;
    }) => void;
    f.pair.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.pairing.start({ requestId: id, beingId: "willow" });
    const rejected = expect(pending).rejects.toThrow(
      mode === "cancel" ? "取消" : "身份已改变",
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    if (mode === "Being") f.changeBeing();
    else if (mode === "Town") f.changeTown();
    else f.pairing.cancel();
    finish({ token: "late-token", beingId: "t_Willow", display: "柳树" });
    await rejected;
    expect(f.save).not.toHaveBeenCalled();
  },
);
it("enforces a deadline even when the pairing stream never emits data", async () => {
  const f = fixture(true, 20);
  await expect(
    f.pairing.start({ requestId: id, beingId: "willow" }),
  ).rejects.toThrow("90 秒");
  expect(f.save).not.toHaveBeenCalled();
});
