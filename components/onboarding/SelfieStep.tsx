"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_HEADS, FRONT_FRAME, SIDE_FRAME, type HeadSpec } from "@/components/courtroom/heads";
import {
  asPerson,
  fallbackSpec,
  frontFit,
  guideBox,
  hairTop,
  loadVision,
  renderCut,
  sideFit,
  within,
  type FrontFit,
} from "./headCut";
import { SELFIE_KEY, saveHeads } from "./sessionHeads";

// Two photos → the heads on all three courtroom characters: front-facing, then turned to the
// right (the side head on profile poses). Background removal + eye/mouth detection run in the
// browser (headCut.ts); without them the guide box is cut out with an oval.

const VISION_MS = 5000; // mock-first rule: give up on vision after 5s

export function sessionSelfie(): string | undefined {
  try {
    return sessionStorage.getItem(SELFIE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

type Kind = "front" | "side";
const FRAME = { front: FRONT_FRAME, side: SIDE_FRAME };
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** The current video frame, mirrored like the preview the user sees. */
function grab(v: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const g = c.getContext("2d")!;
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(v, 0, 0);
  return c;
}

async function cut(kind: Kind, photo: HTMLCanvasElement, front?: FrontFit): Promise<{ spec: HeadSpec; fit?: FrontFit; detected: boolean }> {
  const vision = await within(loadVision(), VISION_MS);
  if (vision) {
    try {
      if (kind === "front") {
        const face = vision.face(photo);
        const raw = vision.segment(photo);
        if (face && raw) {
          const between = { x: (face.eyes[0].x + face.eyes[1].x) / 2, y: (face.eyes[0].y + face.eyes[1].y) / 2 };
          const mask = asPerson(raw, between);
          const hair = hairTop(mask, face.left.x, face.right.x, between.y);
          const { box, spec, fit } = frontFit(face, hair);
          return { spec: { ...spec, src: renderCut(photo, box, FRONT_FRAME, mask) }, fit, detected: true };
        }
      } else if (front) {
        const raw = vision.segment(photo);
        const mask = raw && asPerson(raw, { x: photo.width / 2, y: photo.height / 2 });
        const r = mask && sideFit(mask, front);
        if (mask && r) return { spec: { ...r.spec, src: renderCut(photo, r.box, SIDE_FRAME, mask) }, detected: true };
      }
    } catch {
      // fall through to the guide box
    }
  }
  const box = guideBox(kind, photo.width, photo.height);
  return { spec: { ...fallbackSpec(kind), src: renderCut(photo, box, FRAME[kind], null) }, detected: false };
}

export default function SelfieStep({ onDone }: { onDone: (dataUrl: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [kind, setKind] = useState<Kind>("front");
  const [front, setFront] = useState<{ spec: HeadSpec; fit?: FrontFit } | null>(null);
  const [shot, setShot] = useState<{ spec: HeadSpec; fit?: FrontFit; detected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false); // camera has frames: Take photo is disabled until then

  useEffect(() => {
    let cancelled = false;
    void loadVision(); // warm up while the user lines up
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 1280, height: 720 } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("No camera — the court will use the default faces."));
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    setShot(await cut(kind, grab(v), front?.fit));
    setBusy(false);
  }

  function finish(side?: HeadSpec) {
    const f = front?.spec ?? shot?.spec;
    if (f) saveHeads({ front: f, side });
    stream.current?.getTracks().forEach((t) => t.stop());
    onDone(f?.src ?? null);
  }

  function use() {
    if (!shot) return;
    if (kind === "front") {
      setFront(shot);
      setShot(null);
      setKind("side");
    } else finish(shot.spec);
  }

  // Guide: the head frame (hair to chin), with the default eye + mouth marks to line up with.
  const guide = DEFAULT_HEADS[kind];
  const chin = kind === "side" ? SIDE_FRAME.chin / SIDE_FRAME.h : 1;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-5">
      <p className="text-lg text-zinc-300">
        {kind === "front" ? "Look at the camera: hair at the top of the box, chin on the bottom." : "Now turn to your right, so the camera sees your profile."}
      </p>
      {error ? (
        <p className="text-zinc-400">{error}</p>
      ) : (
        <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900" style={{ aspectRatio: "16 / 9" }}>
          {shot && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL preview
            <img src={shot.spec.src} alt={kind === "front" ? "Your face" : "Your profile"} className="absolute left-1/2 top-1/2 z-10 h-[55%] -translate-x-1/2 -translate-y-1/2" />
          )}
          <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} className={`h-full w-full -scale-x-100 object-cover ${shot ? "opacity-20" : ""}`} />
          {!shot && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-amber-400/70" style={{ aspectRatio: `${guide.w} / ${guide.h}` }}>
              {guide.eyes.map(([x, y], i) => (
                <span key={i} className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400" style={{ left: pct(x), top: pct(y) }} />
              ))}
              <span className="absolute left-1/4 h-0.5 w-1/2 bg-amber-400" style={{ top: pct(guide.lipY) }} />
              {kind === "side" && <span className="absolute inset-x-0 h-0.5 bg-amber-400/60" style={{ top: pct(chin) }} />}
            </div>
          )}
        </div>
      )}
      {shot && !shot.detected && <p className="text-sm text-zinc-500">Couldn’t find your face clearly: using the guide box. Retake for a cleaner cut-out.</p>}
      <div className="flex gap-3">
        {!shot && !error && (
          <button className="rounded-full bg-red-600 px-8 py-3 text-lg font-bold text-white disabled:opacity-40" disabled={!ready || busy} onClick={capture}>
            {busy ? "Cutting out…" : ready ? "📸 Take photo" : "Starting camera…"}
          </button>
        )}
        {shot && <button className="rounded-full bg-zinc-700 px-6 py-3 text-white" onClick={() => setShot(null)}>Retake</button>}
        {shot && <button className="rounded-full bg-red-600 px-8 py-3 text-lg font-bold text-white" onClick={use}>{kind === "front" ? "Next: side photo" : "Use these"}</button>}
        <button className="rounded-full px-6 py-3 text-zinc-400 hover:text-white" onClick={() => (kind === "side" ? finish() : onDone(null))}>
          Skip
        </button>
      </div>
    </div>
  );
}
