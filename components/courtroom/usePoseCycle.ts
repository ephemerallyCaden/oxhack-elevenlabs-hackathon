'use client';
// Drives one character's pose + animation frame from its mood (rules in poses.ts).
import { useEffect, useRef, useState } from 'react';
import type { CharacterMood, CourtActor } from './expressions';
import { FRAME_MS, INTERRUPT_POSE, REST_POSE, nextFrame, nextTickMs, pickPose, poseOf, reactionPose } from './poses';

export function usePoseCycle(role: CourtActor, mood: CharacterMood, interrupting = false) {
  const { expression, talking } = mood;
  const cycles = role !== 'judge'; // the Judge has one static pose
  const [cur, setCur] = useState(() => ({
    pose: (cycles && (interrupting ? INTERRUPT_POSE : !talking && reactionPose(expression))) || REST_POSE,
    frame: 0,
  }));
  const [seen, setSeen] = useState({ expression, interrupting });

  // Interrupt → front neutral; a silent lawyer who becomes shocked / breaks down jumps to it.
  if (seen.expression !== expression || seen.interrupting !== interrupting) {
    setSeen({ expression, interrupting });
    const jump =
      interrupting && !seen.interrupting
        ? INTERRUPT_POSE
        : !interrupting && !talking && seen.expression !== expression
          ? reactionPose(expression)
          : undefined;
    if (cycles && jump && jump !== cur.pose) setCur({ pose: jump, frame: 0 });
  }

  // Otherwise the expression only changes the pool: the new pose comes at the next tick.
  const expr = useRef(expression);
  useEffect(() => {
    expr.current = expression;
  }, [expression]);

  useEffect(() => {
    if (!cycles || !talking || interrupting) return; // not talking: hold the current pose
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        setCur((c) => ({ pose: pickPose(expr.current, c.pose), frame: 0 }));
        schedule();
      }, nextTickMs());
    };
    schedule();
    return () => clearTimeout(id);
  }, [cycles, talking, interrupting]);

  const spec = poseOf(role, cur.pose);
  const animated = spec.anim !== 'static' && spec.frames.length > 1;
  useEffect(() => {
    if (!animated) return;
    const step = (c: typeof cur) => {
      const frame = c.pose === cur.pose ? nextFrame(spec, c.frame) : c.frame;
      return frame === c.frame ? c : { ...c, frame };
    };
    const id = setInterval(() => setCur(step), FRAME_MS);
    return () => clearInterval(id);
  }, [animated, cur.pose, spec]);

  return { pose: cur.pose, frame: Math.min(cur.frame, spec.frames.length - 1), spec };
}
