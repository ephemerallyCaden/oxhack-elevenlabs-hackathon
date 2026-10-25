"use client";

import { useState } from "react";
import QRCode from "qrcode";
import type { Transcript } from "@/types";

// At the verdict: nothing is stored unless the user asks. "Save & share" saves the trial (transcript +
// verdict, no voice or face) for 7 days and shows a QR code + link to /t/[id] for their phone.
export default function SharePanel({ transcript, onSaved }: { transcript: Transcript; onSaved?: (id: string) => void }) {
  const [state, setState] = useState<"ask" | "saving" | "saved" | "failed">("ask");
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null);

  async function save() {
    setState("saving");
    try {
      const r = await fetch("/api/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }) });
      if (!r.ok) throw new Error(String(r.status));
      const { id } = (await r.json()) as { id: string };
      onSaved?.(id);
      const url = `${window.location.origin}/t/${id}`;
      setLink({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-lg bg-white/5 p-3" data-testid="share-panel">
      {state === "saved" && link ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={link.qr} alt="QR code to your trial" className="size-28 rounded bg-white p-1" />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-bold text-amber-400">Take your trial home</span>
            <span className="text-zinc-400">Scan for the full transcript and sources. The link works for 7 days.</span>
            <a className="break-all text-zinc-300 underline" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            className="rounded-full bg-amber-500 px-5 py-2 font-bold text-black hover:bg-amber-400 disabled:opacity-50"
            disabled={state === "saving"}
            onClick={save}
          >
            {state === "saving" ? "Saving…" : "Save & share this trial"}
          </button>
          <span className="max-w-sm text-zinc-400">
            {state === "failed"
              ? "Couldn’t save it, try again."
              : "Stores the transcript and verdict (no voice or face) for 7 days so you can open it on your phone. Nothing is saved unless you click."}
          </span>
        </div>
      )}
    </div>
  );
}
