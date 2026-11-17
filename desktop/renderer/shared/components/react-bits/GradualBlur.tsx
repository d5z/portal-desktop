import { useMemo, type CSSProperties } from 'react';

type GradualBlurProps = {
  position: 'top' | 'bottom';
  height: string;
  strength: number;
  tint: string;
  className: string;
};

const layerCount = 6;
const curve = (t: number) => t * t * (3 - 2 * t);

// Keep the approved Gradual Blur masks. The host sets --gradual-blur-reveal
// with the measurements it already makes for the reading position.
export default function GradualBlur({ position, height, strength, tint, className }: GradualBlurProps) {
  const { layers, wash } = useMemo(() => {
    const direction = `to ${position}`;
    const level = (u: number) => strength * 12 * curve(u);
    const layers = Array.from({ length: layerCount }, (_, index): CSSProperties => {
      const start = index / layerCount;
      const end = (index + 1) / layerCount;
      const radius = Math.sqrt(level(end) ** 2 - level(start) ** 2);
      return {
        backdropFilter: `blur(calc(${radius.toFixed(3)}px * var(--gradual-blur-reveal)))`,
        maskImage: `linear-gradient(${direction}, transparent ${(start * 100).toFixed(2)}%, #000 ${(end * 100).toFixed(2)}%)`,
      };
    });
    const stops = Array.from({ length: 9 }, (_, index) => {
      const step = index / 8;
      const t = curve(step);
      const alpha = t * t * t * (t * (t * 6 - 15) + 10);
      return `rgba(0, 0, 0, ${alpha.toFixed(3)}) ${(step * 100).toFixed(1)}%`;
    });
    const wash: CSSProperties = {
      background: tint,
      maskImage: `linear-gradient(${direction}, ${stops.join(', ')})`,
      opacity: 'var(--gradual-blur-reveal)',
    };
    return { layers, wash };
  }, [position, strength, tint]);

  return (
    <div className={`gradual-blur ${className}`} data-edge={position} aria-hidden="true" style={{ height }}>
      {layers.map((layer, index) => <div key={index} style={layer} />)}
      <div style={wash} />
    </div>
  );
}
