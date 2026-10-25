import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SharePanel from "./SharePanel";
import type { Transcript } from "@/types";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") } }));

const transcript: Transcript = { question: "Should I move to Lisbon?", lines: [], sources: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SharePanel", () => {
  it("stores nothing until the user clicks Save & share", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePanel transcript={transcript} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save & share this trial" })).toBeTruthy();
    expect(screen.getByText(/Nothing is saved unless you click/)).toBeTruthy();
  });

  it("saves on click and shows the 7-day link", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc12345" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePanel transcript={transcript} />);
    fireEvent.click(screen.getByRole("button", { name: "Save & share this trial" }));
    await waitFor(() => expect(screen.getByText(/link works for 7 days/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/trials", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/\/t\/abc12345$/);
  });

  it("lets the user retry when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<SharePanel transcript={transcript} />);
    fireEvent.click(screen.getByRole("button", { name: "Save & share this trial" }));
    await waitFor(() => expect(screen.getByText(/Couldn’t save it, try again/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save & share this trial" })).toBeTruthy();
  });
});

describe("SharePanel: retries, double clicks, what leaves the browser", () => {
  const voiced: Transcript = {
    question: "Should I move?",
    lines: [{ id: "l1", speaker: "prosecution", kind: "argument", text: "It pays everything.", tts: "[passionate] It pays", cites: [], audioUrl: "data:audio/mpeg;base64,AAAA", punch: { text: "everything.", tts: "[passionate] every... thing.", audioUrl: "data:audio/mpeg;base64,BBBB" } }],
    sources: [],
  };

  it("sends the words only: no voice audio or TTS text, punch clips included", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => (void args, new Response(JSON.stringify({ id: "abc12345" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePanel transcript={voiced} />);
    fireEvent.click(screen.getByRole("button", { name: "Save & share this trial" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).not.toContain("data:audio");
    expect(body).not.toContain("[passionate]");
    expect(JSON.parse(body).transcript.lines[0].punch).toEqual({ text: "everything." });
  });

  it("can't be double-submitted while saving, and a retry after a failure works", async () => {
    let fail = true;
    const fetchMock = vi.fn(async () => (fail ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ id: "abc12345" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<SharePanel transcript={transcript} onSaved={onSaved} />);
    const button = screen.getByRole("button", { name: "Save & share this trial" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(screen.getByText(/Couldn’t save it, try again/)).toBeTruthy());
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Save & share this trial" }));
    await waitFor(() => expect(screen.getByRole("link")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledWith("abc12345");
  });

  it("shows the link even if the QR code fails (no second save)", async () => {
    const qrcode = (await import("qrcode")).default as unknown as { toDataURL: ReturnType<typeof vi.fn> };
    qrcode.toDataURL.mockRejectedValueOnce(new Error("canvas"));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc12345" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharePanel transcript={transcript} />);
    fireEvent.click(screen.getByRole("button", { name: "Save & share this trial" }));
    await waitFor(() => expect(screen.getByRole("link").getAttribute("href")).toMatch(/\/t\/abc12345$/));
    expect(screen.queryByRole("img")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
