'use client';
// The spectrum HUD: blocky yellow-framed tug-of-war meter, top centre of the 960×540 stage.
// Rules in spectrumRules.ts; look + timings tuned in public/mockups/spectrum-bar.html. Every change
// animates (one at a time, queued): a ruling steps block by block, a lead change drains through the
// centre, an agenda change re-weighs, the verdict pulses with the gavel and locks. Animation drives
// the DOM directly (like the camera), so a block stepping doesn't re-render React.
import { useEffect, useRef } from 'react';
import { BAR, blocksOf, causeOf, labelOf, planMove, verdictSide, type BarCause, type BarState, type Tone } from './spectrumRules';

export type BarSfx = (name: 'needle_up' | 'needle_down' | 'blip' | 'gasp', volume: number) => void;

const BLOCKS = Array.from({ length: 2 * BAR.side }, (_, i) => i);
const TONE: Record<Tone, string> = { yes: 'var(--spec-yes)', no: 'var(--spec-no)', gold: 'var(--spec-gold)', grey: '#9a9aa8' };
/** Marker x (px inside the frame): frame padding 4 + the centre gap + n blocks. */
const markerX = (n: number) => 4 + BAR.side * BAR.pitch - 1 + n * BAR.pitch;
const GLINT_MS = 4500;

interface Els {
  root: HTMLDivElement;
  label: HTMLDivElement;
  frame: HTMLDivElement;
  bar: HTMLDivElement;
  notch: HTMLDivElement;
  marker: HTMLDivElement;
  value: HTMLDivElement;
  chip: HTMLDivElement;
  glint: HTMLDivElement;
  endNo: HTMLSpanElement;
  endYes: HTMLSpanElement;
}

/** Restart a one-shot CSS animation class. */
function once(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

class Animator {
  shown = 0; // blocks lit now (−10 … +10)
  value = 0; // the number on screen
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private queue: Promise<void> = Promise.resolve();
  private dead = false;
  constructor(
    private el: Els,
    private sfx: () => BarSfx | undefined,
  ) {}

  private get blocks() {
    return [...this.el.bar.children] as HTMLElement[];
  }
  private wait(ms: number) {
    return new Promise<void>((r) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        r();
      }, ms);
      this.timers.add(id);
    });
  }
  private play(name: Parameters<BarSfx>[0], volume = 1) {
    this.sfx()?.(name, volume);
  }
  /** Run animations one after another; a dead animator drops the rest. */
  enqueue(fn: () => Promise<void>) {
    this.queue = this.queue.then(() => (this.dead ? undefined : fn())).catch(() => undefined);
    return this.queue;
  }
  kill() {
    this.dead = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  /** k-th block from the centre on a side (side −1 = NO, +1 = YES). */
  private at(side: number, k: number) {
    return this.blocks[side < 0 ? BAR.side - k : BAR.side - 1 + k];
  }
  paint(n: number) {
    this.blocks.forEach((b, i) => {
      const k = i < BAR.side ? BAR.side - i : i - BAR.side + 1;
      const yesSide = i >= BAR.side;
      b.classList.toggle('on-no', !yesSide && n < 0 && k <= -n);
      b.classList.toggle('on-yes', yesSide && n > 0 && k <= n);
    });
    this.el.marker.style.left = `${markerX(n)}px`;
  }
  private setNumber(v: number) {
    this.value = v;
    this.el.value.textContent = `${v > 0 ? '+' : ''}${v}`;
  }
  private setLabel(v: number, tint?: 'yes' | 'no') {
    const text = labelOf(v), el = this.el.label;
    if (el.textContent === text) return;
    once(el, 'flip');
    void this.wait(100).then(() => (el.textContent = text));
    if (!tint) return;
    el.classList.add(`tint-${tint}`);
    void this.wait(700).then(() => el.classList.remove(`tint-${tint}`));
  }
  private chip(text: string, tone: Tone, big: boolean) {
    const c = this.el.chip;
    c.textContent = text;
    c.style.color = TONE[tone];
    c.classList.toggle('big', big);
    c.style.left = this.el.marker.style.left;
    once(c, 'go');
  }
  /** Count the number from → to over `ms`, in ~16 steps. */
  private async count(from: number, to: number, ms: number) {
    const n = Math.max(1, Math.min(16, Math.round(ms / 30)));
    for (let i = 1; i <= n; i++) {
      await this.wait(ms / n);
      this.setNumber(Math.round(from + ((to - from) * i) / n));
    }
  }
  /** Step the fill one block at a time to `n`; each block that lights (or goes out) flashes. */
  private async stepTo(n: number, perMs: number, tick: boolean) {
    while (this.shown !== n) {
      const dir = Math.sign(n - this.shown);
      const growing = Math.abs(this.shown + dir) > Math.abs(this.shown);
      const b = growing ? this.at(Math.sign(this.shown + dir), Math.abs(this.shown + dir)) : this.at(Math.sign(this.shown), Math.abs(this.shown));
      this.shown += dir;
      this.paint(this.shown);
      if (b) {
        const cls = growing ? 'pop' : 'out';
        b.classList.add(cls);
        void this.wait(perMs * 0.6).then(() => b.classList.remove(cls));
      }
      if (tick) this.play('blip', 0.18);
      await this.wait(perMs);
    }
    once(this.el.marker, 'land');
  }

  /** A ruling, re-weigh or the verdict's own correction moves the bar to `to`. */
  async move(to: number, cause: BarCause) {
    const p = planMove(this.value, to, cause);
    const reweigh = cause === 'reweigh';
    const per = reweigh ? BAR.reweighMs : BAR.blockMs;
    this.unlock();
    if (p.hold) {
      void this.count(p.from, p.to, 300);
      if (p.chip) this.chip(p.chip.text, p.chip.tone, p.chip.big);
      for (const k of [1, 0, -1, 0, 1, 0]) {
        this.paint(this.shown + k * 0.35);
        await this.wait(BAR.holdMs);
      }
      this.paint(this.shown);
      this.setLabel(p.to);
      return;
    }
    this.play(p.sound, reweigh ? 0.5 : 1);
    if (reweigh) this.el.bar.classList.add('reweigh');
    if (p.swing) once(this.el.root, p.lead ? 'shake-big' : 'shake');
    let start = p.from;
    if (p.lead) {
      const drain = Math.abs(this.shown) * per * 0.7;
      await Promise.all([this.stepTo(0, per * 0.7, !reweigh), this.count(p.from, 0, drain)]);
      once(this.el.notch, 'burst');
      this.play('gasp', 0.5);
      if (p.chip) this.chip(p.chip.text, p.chip.tone, p.chip.big);
      await this.wait(180);
      start = 0;
    }
    const n = blocksOf(p.to);
    await Promise.all([this.stepTo(n, per, !reweigh), this.count(start, p.to, Math.abs(n - this.shown) * per)]);
    this.el.bar.classList.remove('reweigh');
    if (!p.lead && p.chip) this.chip(p.chip.text, p.chip.tone, p.chip.big);
    if (p.wall) {
      once(this.el.frame, p.to > 0 ? 'wall-yes' : 'wall-no');
      once(this.el.root, 'shake');
      this.paint(this.shown - Math.sign(this.shown) * 0.5);
      await this.wait(70);
      this.paint(this.shown);
    }
    const d = p.to - p.from;
    if (!reweigh) once(d > 0 ? this.el.endYes : this.el.endNo, 'flash');
    this.setLabel(p.to, reweigh ? undefined : d > 0 ? 'yes' : 'no');
  }

  /** The verdict: settle on its value, pulse with the page's three gavel hits, dim the loser, lock. */
  async verdict(to: number) {
    if (to !== this.value) await this.move(to, 'verdict');
    for (let i = 0; i < 3; i++) {
      once(this.el.frame, 'pulse');
      once(this.el.root, 'shake');
      await this.wait(300); // the page's gavel(3) spacing
    }
    const side = verdictSide(this.value);
    this.blocks.forEach((b) => {
      const lit = b.classList.contains('on-yes') || b.classList.contains('on-no');
      const winner = side === 'yes' ? b.classList.contains('on-yes') : side === 'no' ? b.classList.contains('on-no') : lit;
      b.classList.toggle('dim', !winner);
    });
    this.el.root.classList.add('locked', `verdict-${side}`);
    this.chip(labelOf(this.value), side === 'tie' ? 'gold' : side, true);
  }
  private unlock() {
    this.el.root.classList.remove('locked', 'verdict-yes', 'verdict-no', 'verdict-tie');
    this.blocks.forEach((b) => b.classList.remove('dim'));
  }

  /** Drop in, power-on sweep from the centre, then fill to the current value. */
  async appear(value: number) {
    this.el.root.classList.remove('leave');
    once(this.el.root, 'in');
    this.play('blip', 0.6);
    this.shown = 0;
    this.paint(0);
    this.setNumber(value);
    this.el.label.textContent = labelOf(value);
    await this.wait(340);
    for (let k = 1; k <= BAR.side; k++) {
      this.at(-1, k).classList.add('pop');
      this.at(1, k).classList.add('pop');
      await this.wait(18);
    }
    await this.wait(60);
    this.blocks.forEach((b) => b.classList.remove('pop'));
    await this.stepTo(blocksOf(value), 25, false);
  }
  glint() {
    if (!this.el.root.classList.contains('locked')) once(this.el.glint, 'go');
  }
}

export default function SpectrumBar({
  value,
  scored,
  verdict,
  visible,
  sfx,
}: BarState & {
  /** Hidden through the intro / before the trial; it drops in when this turns on. */
  visible: boolean;
  sfx?: BarSfx;
}) {
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const notch = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const valueEl = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const glint = useRef<HTMLDivElement>(null);
  const endNo = useRef<HTMLSpanElement>(null);
  const endYes = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animator | null>(null);
  const sfxRef = useRef(sfx);
  const seen = useRef<BarState>({ value, scored, verdict });
  const wasVisible = useRef(false);

  useEffect(() => {
    sfxRef.current = sfx;
  });

  // One animator per mount, built on the rendered DOM.
  useEffect(() => {
    const els = {
      root: root.current, label: label.current, frame: frame.current, bar: bar.current, notch: notch.current, marker: marker.current,
      value: valueEl.current, chip: chip.current, glint: glint.current, endNo: endNo.current, endYes: endYes.current,
    } as Els;
    const a = new Animator(els, () => sfxRef.current);
    a.paint(0);
    anim.current = a;
    return () => a.kill();
  }, []);

  // Shown / hidden.
  useEffect(() => {
    const a = anim.current, el = root.current;
    if (!a || !el || visible === wasVisible.current) return;
    wasVisible.current = visible;
    if (visible) {
      seen.current = { value, scored, verdict };
      void a.enqueue(() => a.appear(value));
    } else once(el, 'leave');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rulings, re-weighs and the verdict, in the order they happen.
  useEffect(() => {
    const a = anim.current;
    const next = { value, scored, verdict };
    const cause = causeOf(seen.current, next);
    seen.current = next;
    if (!a || !cause || !wasVisible.current) return;
    void a.enqueue(() => (cause === 'verdict' ? a.verdict(value) : a.move(value, cause)));
  }, [value, scored, verdict]);

  // Idle glint.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => anim.current?.glint(), GLINT_MS);
    return () => clearInterval(id);
  }, [visible]);

  return (
    <div ref={root} className={`spec-hud${visible ? '' : ' spec-hidden'}`} data-spectrum aria-label={`Spectrum ${labelOf(value)}, ${value > 0 ? '+' : ''}${value}`}>
      <div className="spec-top">
        <span ref={endNo} className="spec-end no">NO</span>
        <div ref={label} className="spec-label" data-spectrum-label>
          {labelOf(0)}
        </div>
        <span ref={endYes} className="spec-end yes">YES</span>
      </div>
      <div ref={frame} className="spec-frame">
        <div ref={bar} className="spec-bar">
          {BLOCKS.map((i) => (
            <div key={i} className={`spec-blk ${i < BAR.side ? 'side-no' : 'side-yes'}`} />
          ))}
        </div>
        <div ref={notch} className="spec-notch" />
        <div ref={marker} className="spec-marker" />
        <div ref={glint} className="spec-glint" />
      </div>
      <div ref={valueEl} className="spec-value" data-spectrum-value>
        0
      </div>
      <div ref={chip} className="spec-chip" />
    </div>
  );
}
