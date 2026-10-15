/**
 * Lumi, the assistant's cat (KOS10, 0045): a small inline SVG with idle · think · happy · sleep
 * states, ported from recipe-cat's Kitchen OS `Cat.tsx` and recoloured with the cream art colours
 * (`--art-*`, globals.css), which stay the same in both themes. State motion lives in globals.css
 * (`.lumi-cat`) and switches off with reduced motion.
 *
 * Decorative by default. Pass `title` (already translated, 0015) when Lumi is the only thing
 * saying something, e.g. an empty state; then she becomes a named image.
 *
 * For the large cream illustrations (chef, celebrating, listening…) use `LUMI_ART` with an <img>.
 */
export type LumiState = "idle" | "think" | "happy" | "sleep";

/** Cream Lumi illustrations in public/art/lumi (decorative SVGs; give the <img> an alt from next-intl). */
export const LUMI_ART = {
  idle: "/art/lumi/idle.svg",
  thinking: "/art/lumi/thinking.svg",
  listening: "/art/lumi/listening.svg",
  working: "/art/lumi/working.svg",
  celebrating: "/art/lumi/celebrating.svg",
  sleeping: "/art/lumi/sleeping.svg",
  alert: "/art/lumi/alert.svg",
  chef: "/art/lumi/chef.svg",
  bubble: "/art/lumi/bubble.svg",
} as const;
export type LumiArtName = keyof typeof LUMI_ART;

const LINE = "var(--art-ink)";
const FUR = "var(--art-cream)";
const PINK = "var(--art-blush)";

export function Lumi({ state = "idle", size = 32, title }: { state?: LumiState; size?: number; title?: string }) {
  return (
    <svg
      className="lumi-cat"
      data-state={state}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g className="lumi-head">
        <path d="M9 31 L12 8 Q13 4.5 16.5 6.5 L30 16 Z" fill={FUR} stroke={LINE} strokeWidth="3" strokeLinejoin="round" />
        <path d="M55 31 L52 8 Q51 4.5 47.5 6.5 L34 16 Z" fill={FUR} stroke={LINE} strokeWidth="3" strokeLinejoin="round" />
        <path d="M14.5 23 L15.5 11.5 L23.5 17 Z" fill={PINK} />
        <path d="M49.5 23 L48.5 11.5 L40.5 17 Z" fill={PINK} />
        <ellipse cx="32" cy="37.5" rx="25" ry="20.5" fill={FUR} stroke={LINE} strokeWidth="3" />
        <path d="M26 19.5 Q32 16 38 19.5" fill="none" stroke="var(--art-peach)" strokeWidth="2.6" strokeLinecap="round" />
        <g className="lumi-eyes">
          <ellipse cx="23" cy="36" rx="3.3" ry="3.9" fill={LINE} />
          <ellipse cx="41" cy="36" rx="3.3" ry="3.9" fill={LINE} />
          <circle cx="24.1" cy="34.5" r="1.15" fill={FUR} />
          <circle cx="42.1" cy="34.5" r="1.15" fill={FUR} />
        </g>
        <g className="lumi-happy-eyes" fill="none" stroke={LINE} strokeWidth="3" strokeLinecap="round">
          <path d="M19.4 37.2 Q23 32.2 26.6 37.2" />
          <path d="M37.4 37.2 Q41 32.2 44.6 37.2" />
        </g>
        <ellipse cx="16" cy="43.5" rx="4.2" ry="2.7" fill={PINK} opacity="0.7" />
        <ellipse cx="48" cy="43.5" rx="4.2" ry="2.7" fill={PINK} opacity="0.7" />
        <path
          d="M28.4 42.6 Q30.2 45.3 32 42.9 Q33.8 45.3 35.6 42.6"
          fill="none"
          stroke={LINE}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
