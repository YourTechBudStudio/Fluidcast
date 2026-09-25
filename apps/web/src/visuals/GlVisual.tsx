import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { Rgb } from '../ui';
import type { Renderer, RendererFactory } from './engine';
import type { VisualInputs } from './types';

import './visuals.css';

export interface GlVisualProps {
  readonly tag: string;
  readonly factory: RendererFactory;
  readonly shape: 'band' | 'orb';
  readonly inputs: VisualInputs;
  /** When false the render loop stops, for example while the transcript layer is showing. */
  readonly active: boolean;
  /** The three fallback tones for the current state. */
  readonly fallbackTones: readonly [Rgb, Rgb, Rgb];
  readonly fallback: ReactNode;
  readonly className?: string;
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;

/**
 * Hosts one WebGL visual: owns the canvas, the animation loop and context loss, and swaps to the CSS fallback when WebGL
 * is unavailable. The renderer owns the simulation; per-frame analysis is read here, never through React state.
 */
export function GlVisual({
  tag,
  factory,
  shape,
  inputs,
  active,
  fallbackTones,
  fallback,
  className = '',
}: GlVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const inputsRef = useRef(inputs);
  const [failed, setFailed] = useState(false);
  const { state, reducedMotion, held } = inputs;

  useLayoutEffect(() => {
    inputsRef.current = inputs;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const create = () => {
      const latest = inputsRef.current;
      rendererRef.current = factory(canvas, {
        state: latest.state,
        reducedMotion: latest.reducedMotion,
        held: latest.held,
      });
      setFailed(rendererRef.current === null);
    };
    // While the context is lost, show the CSS fallback; the loop stops. On restoration, rebuild the renderer on the new context.
    const onLost = (event: Event) => {
      event.preventDefault();
      rendererRef.current = null;
      setFailed(true);
      console.warn(`[${tag}] context lost`);
    };
    create();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', create);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', create);
      rendererRef.current = null;
    };
  }, [factory, tag]);

  useEffect(() => {
    rendererRef.current?.retarget({ state, reducedMotion, held }, performance.now());
  }, [state, reducedMotion, held]);

  useEffect(() => {
    if (!active || failed) return;
    let frame = 0;
    const tick = (now: number) => {
      const renderer = rendererRef.current;
      if (renderer) {
        const { analysis } = inputsRef.current;
        analysis.update(now);
        renderer.draw(now, analysis);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, failed]);

  const [fa, fb, fc] = fallbackTones;
  const style = { '--fa': css(fa), '--fb': css(fb), '--fc': css(fc) } as CSSProperties;

  return (
    <div
      className={`visual-slot ${className}`}
      data-shape={shape}
      data-webgl={failed ? 'off' : 'on'}
      style={style}
      aria-hidden
    >
      <canvas ref={canvasRef} className="visual-canvas" hidden={failed} />
      {failed && fallback}
    </div>
  );
}
