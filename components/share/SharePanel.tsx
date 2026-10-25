"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Transcript } from "@/types";

// At the verdict: save the trial once and show a QR code + link to /t/[id] (scan to read it on your phone).
export default function SharePanel({ transcript, onSaved }: { transcript: Transcript; onSaved?: (id: string) => void }) {
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const saved = useRef(false);

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    fetch("/api/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(async ({ id }: { id: string }) => {
        onSaved?.(id);
        const url = `${window.location.origin}/t/${id}`;
        setLink({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
      })
      .catch(() => setFailed(true));
  }, [transcript, onSaved]);

  if (failed) return null;
  return (
    <div className="flex items-center gap-4 rounded-lg bg-white/5 p-3" data-testid="share-panel">
      {link ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={link.qr} alt="QR code to your trial" className="size-28 rounded bg-white p-1" />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-bold text-amber-400">Take your trial home</span>
            <span className="text-zinc-400">Scan for the full transcript and sources.</span>
            <a className="break-all text-zinc-300 underline" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
          </div>
        </>
      ) : (
        <span className="text-sm text-zinc-400">Saving the court record…</span>
      )}
    </div>
  );
}
