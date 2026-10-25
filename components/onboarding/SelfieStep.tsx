"use client";

import { useEffect, useRef, useState } from "react";
import { FACE_CAL } from "@/components/courtroom/expressions";

// Selfie → the face on all three courtroom characters (replaces /assets/face.png).
// The courtroom's expression overlays are calibrated to face.png (FACE_CAL), so the camera shows
// guide marks at those eye/mouth positions and the photo is cropped to the same frame.
// Background removal / lip detection (C9, design) can replace the oval mask later.

const W = 232; // face.png size: keep the same frame so FACE_CAL lines up
const H = 214;
const SESSION_KEY = "roulette.selfie";

export function sessionSelfie(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export default function SelfieStep({ onDone }: { onDone: (dataUrl: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false); // camera has frames: Take photo is disabled until then

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("No camera — the court will use the default face."));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // The guide box is the largest W:H rectangle centred in the video, using 60% of its height.
    const boxH = v.videoHeight * 0.6;
    const boxW = (boxH * W) / H;
    const sx = (v.videoWidth - boxW) / 2;
    const sy = (v.videoHeight - boxH) / 2;
    const c = document.createElement("canvas");
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext("2d")!;
    // Oval mask with a soft edge stands in for a cutout.
    g.save();
    g.beginPath();
    g.ellipse(c.width / 2, c.height * 0.55, c.width * 0.42, c.height * 0.5, 0, 0, Math.PI * 2);
    g.clip();
    g.translate(c.width, 0); // mirror, like the preview the user saw
    g.scale(-1, 1);
    g.drawImage(v, sx, sy, boxW, boxH, 0, 0, c.width, c.height);
    g.restore();
    setShot(c.toDataURL("image/png"));
  }

  function use() {
    try {
      if (shot) sessionStorage.setItem(SESSION_KEY, shot);
    } catch {
      // storage full / private mode: default face
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    onDone(shot);
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-5">
      <p className="text-lg text-zinc-300">Line your eyes and mouth up with the marks.</p>
      {error ? (
        <p className="text-zinc-400">{error}</p>
      ) : (
        <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900" style={{ aspectRatio: "16 / 9" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
          {shot && <img src={shot} alt="Your selfie" className="absolute left-1/2 top-1/2 h-[60%] -translate-x-1/2 -translate-y-1/2" />}
          <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} className={`h-full w-full -scale-x-100 object-cover ${shot ? "opacity-0" : ""}`} />
          {!shot && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[60%] -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-amber-400/70" style={{ aspectRatio: `${W} / ${H}` }}>
              {[FACE_CAL.eyeViewerLeft, FACE_CAL.eyeViewerRight].map((e, i) => (
                <span key={i} className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400" style={{ left: pct(e.x), top: pct(e.y) }} />
              ))}
              <span className="absolute left-1/4 h-0.5 w-1/2 bg-amber-400" style={{ top: pct(FACE_CAL.lipY) }} />
            </div>
          )}
        </div>
      )}
      <div className="flex gap-3">
        {!shot && !error && <button className="rounded-full bg-red-600 px-8 py-3 text-lg font-bold text-white disabled:opacity-40" disabled={!ready} onClick={capture}>{ready ? "📸 Take photo" : "Starting camera…"}</button>}
        {shot && <button className="rounded-full bg-zinc-700 px-6 py-3 text-white" onClick={() => setShot(null)}>Retake</button>}
        {shot && <button className="rounded-full bg-red-600 px-8 py-3 text-lg font-bold text-white" onClick={use}>Use this face</button>}
        <button className="rounded-full px-6 py-3 text-zinc-400 hover:text-white" onClick={() => onDone(null)}>Skip</button>
      </div>
    </div>
  );
}
