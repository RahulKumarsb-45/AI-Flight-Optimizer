'use client';

import { cn } from '@/lib/utils';

/**
 * The product's signature visual: a great-circle-style arc between two points,
 * echoing what the optimizer literally computes. Used in the hero (large,
 * animated draw-in), as a section divider (small, static), and in loading
 * states (with a traveling plane via SMIL animateMotion).
 */
function RouteArc({
  fromLabel = 'DEL',
  toLabel = 'LHR',
  width = 480,
  height = 160,
  animated = true,
  showPlane = false,
  className,
  strokeColor = '#F5A623',
}) {
  const startX = 40;
  const endX = width - 40;
  const baseY = height - 40;
  const peakY = 24;

  const pathD = `M ${startX} ${baseY} Q ${width / 2} ${peakY} ${endX} ${baseY}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('h-auto max-w-full overflow-visible', className)}
      role="img"
      aria-label={`Flight route from ${fromLabel} to ${toLabel}`}
    >
      {/* dotted baseline for depth */}
      <line
        x1={startX} y1={baseY} x2={endX} y2={baseY}
        stroke="currentColor" strokeOpacity="0.12" strokeDasharray="1 6" strokeLinecap="round"
        className="text-ink-400"
      />

      {/* the arc itself */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={animated ? 1200 : undefined}
        strokeDashoffset={animated ? 1200 : 0}
        className={animated ? 'animate-route-draw' : ''}
      />

      {/* origin point */}
      <circle cx={startX} cy={baseY} r="5" fill="#1F2A52" />
      <text x={startX} y={baseY + 24} textAnchor="middle" className="fill-ink-600 font-mono text-[11px] tracking-wide">
        {fromLabel}
      </text>

      {/* destination point */}
      <circle cx={endX} cy={baseY} r="5" fill="#1F2A52" />
      <text x={endX} y={baseY + 24} textAnchor="middle" className="fill-ink-600 font-mono text-[11px] tracking-wide">
        {toLabel}
      </text>

      {/* optional traveling plane, for loading/optimizing states */}
      {showPlane && (
        <g>
          <circle r="4" fill="#F5A623">
            <animateMotion dur="2.2s" repeatCount="indefinite" path={pathD} rotate="auto" />
          </circle>
        </g>
      )}
    </svg>
  );
}

export { RouteArc };
