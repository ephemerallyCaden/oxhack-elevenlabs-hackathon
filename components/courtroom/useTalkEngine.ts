'use client';
// Jaw animation driver — React port of the mockup's TalkEngine.
// The jaw opens/closes on a fixed interval; each tick adds a random ±20° wobble.
import { useEffect, type RefObject } from 'react';

export function useTalkEngine(
  jawRef: RefObject<HTMLImageElement | null>,
  talking: boolean,
  { speed = 120, maxRotation = 20, openDistance = 5 } = {},
) {
  useEffect(() => {
    const jaw = jawRef.current;
    if (!jaw) return;
    if (!talking) {
      jaw.style.transform = 'translateY(0) rotate(0deg)';
      return;
    }
    let open = false;
    const tick = () => {
      open = !open;
      const y = open ? openDistance : 0;
      const rot = (Math.random() * 2 - 1) * maxRotation;
      jaw.style.transform = `translateY(${y}px) rotate(${rot.toFixed(1)}deg)`;
    };
    tick();
    const id = setInterval(tick, speed);
    return () => {
      clearInterval(id);
      jaw.style.transform = 'translateY(0) rotate(0deg)';
    };
  }, [jawRef, talking, speed, maxRotation, openDistance]);
}
