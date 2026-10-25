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
