// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CommunityHttpError, createCommunityTransport } from "./community-http";

const endpoint = "https://api.stackexchange.com/2.3/search/advanced";
const signal = () => new AbortController().signal;
describe("bounded community HTTP transport", () => {
  it("rejects unregistered hosts, insecure URLs, credentials and nonstandard ports before fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    for (const url of ["https://evil.example/data", "http://api.stackexchange.com/data", "https://user:secret@api.stackexchange.com/data", "https://api.stackexchange.com:444/data", "https://api.stackexchange.com.evil.example/data"]) {
      await expect(transport.json(url, signal())).rejects.toThrow("Unregistered source endpoint");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(transport.json(endpoint, signal())).resolves.toEqual({});
  });
  it("forces redirect rejection and the bounded signal while preserving explicit API authorization", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"ok":true}'));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    const parent = signal();
    await transport.json(endpoint, parent, { redirect: "follow", headers: { Authorization: "Bearer fixture-only" } });
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(parent);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer fixture-only");
  });
  it("allows four combined text/json requests and rejects the fifth without a network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    await transport.text(endpoint, signal());
    for (let index = 0; index < 3; index++) await transport.json(endpoint, signal());
    await expect(transport.text(endpoint, signal())).rejects.toThrow("request budget");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("preserves API authorization supplied as a standard Headers object", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    await transport.json(endpoint, signal(), { headers: new Headers({ Authorization: "Bearer fixture-only" }) });
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer fixture-only");
  });
  it("enforces actual streamed byte limits even when Content-Length understates the body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(256000).fill(65));
      controller.enqueue(new Uint8Array(256001).fill(65));
    }, cancel });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(stream, { headers: { "content-length": "1" } }));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    await expect(transport.text(endpoint, signal())).rejects.toThrow("body exceeds budget");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("allows exactly 512000 bytes and cancels advertised oversized responses", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("x".repeat(512000)))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { "content-length": "512001" } }));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    expect((await transport.text(endpoint, signal())).length).toBe(512000);
    await expect(transport.text(endpoint, signal())).rejects.toThrow("body exceeds budget");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("shares 429 host cooldown across collection transports and resumes after expiry", async () => {
    let time = Date.parse("2026-10-25T12:00:00Z");
    const cooldown = new Map<string, number>();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "120" } }))
      .mockResolvedValueOnce(new Response("{}"));
    const options = { hosts: ["api.stackexchange.com"], fetchImpl, cooldown, now: () => time };
    await expect(createCommunityTransport(options).json(endpoint, signal())).rejects.toMatchObject({ status: 429, retryAt: "2026-10-25T12:02:00.000Z" });
    const second = createCommunityTransport(options);
    await expect(second.json(endpoint, signal())).rejects.toBeInstanceOf(CommunityHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time += 120001;
    await expect(second.json(endpoint, signal())).resolves.toEqual({});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("propagates parent cancellation and cancels a stalled response reader", async () => {
    const parent = new AbortController(); const cancel = vi.fn();
    let notifyRead!: () => void;
    const reading = new Promise<void>(resolve => { notifyRead = resolve; });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ pull() { notifyRead(); }, cancel })));
    const transport = createCommunityTransport({ hosts: ["api.stackexchange.com"], fetchImpl });
    const operation = transport.text(endpoint, parent.signal);
    const rejection = expect(operation).rejects.toThrow();
    await reading;
    // Let the response reach the bounded reader before aborting its parent.
    await new Promise(resolve => setImmediate(resolve));
    parent.abort(new Error("caller stopped"));
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
