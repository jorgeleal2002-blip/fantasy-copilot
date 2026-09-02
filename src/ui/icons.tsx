import type { CSSProperties, JSX } from 'react';

/**
 * The line icons the dashboards carry.
 *
 * Drawn here rather than pulled from a set: the app ships two dependencies and
 * an icon font or package would be the third, for eight glyphs. They follow the
 * tab bar's drawing exactly — a 24 box, no fill, `currentColor`, 1.6 stroke —
 * so an icon inside a card and an icon in the dock are visibly the same hand.
 */
export type IconName =
  | 'rank' | 'fit' | 'future' | 'ahead' | 'star' | 'board' | 'alert';

const PATHS: Record<IconName, JSX.Element> = {
  // A trophy: where you place among the other managers.
  rank: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 5.5H4V7a3.5 3.5 0 0 0 3.5 3.5" />
      <path d="M17 5.5h3V7a3.5 3.5 0 0 1-3.5 3.5" />
      <path d="M12 14v3M10 17h4M8.5 20h7" />
    </>
  ),
  // A target: quality is how close the lineup is to the best it could be.
  fit: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  future: (
    <>
      <path d="M4 16l5.5-5.5 3 3L20 5" />
      <path d="M14.5 5H20v5.5" />
    </>
  ),
  ahead: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  star: <path d="M12 3.5l2.2 5.4 5.8.5-4.4 3.8 1.3 5.7L12 15.9l-4.9 3 1.3-5.7L4 9.4l5.8-.5z" />,
  // A draft board: a header row and the columns under it.
  board: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5v10M15.5 9.5v10" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5M12 16.2h.01" />
    </>
  ),
};

export function Icon({ name, size = 16, style }: {
  name: IconName; size?: number; style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
