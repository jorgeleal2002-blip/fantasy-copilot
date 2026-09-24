import { useId } from 'react';

/**
 * The app mark: the two of them, on a badge split down the middle — Carolina
 * blue for the Doctor, Steelers gold for stein.
 *
 * Two cuts of one drawing. Below 64px the detail turns to mud, so the
 * simplified sibling takes over automatically — the same handoff rule the
 * identity sheet documents. What survives into the small cut is only what
 * still tells the two apart at that size: a moustache and a parting one way
 * against a bare lip and a parting the other.
 *
 * Each face is the SAME drawing at another centre. Inside a face group the
 * head is always at (256, 266) with rx 100, so there is one set of
 * coordinates to keep in step rather than two — and `public/icon.svg` and
 * `scripts/render-icons.py` draw that same head for the home-screen icon.
 */

const SKIN = { doctor: '#C98A55', stein: '#E2B08A' };
const SHADE = { doctor: '#B67846', stein: '#D09B74' };
const LIP = { doctor: '#8B5A32', stein: '#A8744E' };
const BROW = { doctor: '#4A2C17', stein: '#9A9AA4' };
/** Both white, one a shade off the other and parted the other way, so two
 *  white heads side by side still read as two different things. */
const TOP = { doctor: '#FFFFFF', stein: '#F0F0F4' };

type Who = 'doctor' | 'stein';

export function Mark({ size = 44, title, alive }: { size?: number; title?: string; alive?: boolean }) {
  // ids have to be unique per instance or a second <Mark> steals the first's clip
  const uid = useId().replace(/:/g, '');
  const head = 'h-' + uid;
  const badge = 'b-' + uid;
  const tache = 't-' + uid;
  const detailed = size >= 64;
  // Grouped only when he is meant to move: an extra <g> around every mark in
  // the app would be noise in the markup for the sake of one screen.
  const face = alive ? 'mk-alive' : undefined;
  const eyes = alive ? 'mk-eyes' : undefined;

  // A face group's transform is what `x' = cx + (x − 256)·s` comes out as.
  const at = (cx: number, cy: number, s: number) =>
    `translate(${(cx - 256 * s).toFixed(2)} ${(cy - 266 * s).toFixed(2)}) scale(${s})`;

  const Face = ({ who, small }: { who: Who; small?: boolean }) => (
    <>
      <ellipse cx="256" cy="266" rx="100" ry="119" fill={SKIN[who]} />
      <g clipPath={`url(#${head})`}>
        {small ? null : (
          <>
            <path
              d="M256 249 C263 263, 269 278, 269 286 C269 291, 243 291, 243 286 C243 278, 249 263, 256 249 Z"
              fill={SHADE[who]}
            />
            <path d="M234 327 Q256 333 278 327" stroke={LIP[who]} strokeWidth="6" strokeLinecap="round" fill="none" />
          </>
        )}
        {/* One band, mirrored about the head's centre for the Doctor: a fringe
            swept to one side is what reads as hair, and swept the other way it
            is what keeps him from being the same head twice. */}
        {who === 'doctor'
          ? <path d="M363 120 H149 V212 Q212 232 226 196 Q262 236 363 214 Z" fill={TOP.doctor} />
          : <path d="M149 120 H363 V212 Q300 232 286 196 Q250 236 149 214 Z" fill={TOP.stein} />}
      </g>
      {small ? null : (
        <>
          <path d="M204 236 L240 231 L240 241 L204 245 Z" fill={BROW[who]} />
          <path d="M308 236 L272 231 L272 241 L308 245 Z" fill={BROW[who]} />
        </>
      )}
      <g className={eyes}>
        <ellipse cx="225" cy="256" rx={small ? 14 : 11} ry={small ? 12 : 9} fill="#2B2B33" />
        <ellipse cx="287" cy="256" rx={small ? 14 : 11} ry={small ? 12 : 9} fill="#2B2B33" />
      </g>
      {who === 'doctor' ? (
        <g fill="#FFFFFF">
          <use href={`#${tache}`} />
          <use href={`#${tache}`} transform="translate(512,0) scale(-1,1)" />
        </g>
      ) : null}
    </>
  );

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flex: 'none' }}
    >
      <defs>
        <clipPath id={head}><ellipse cx="256" cy="266" rx="100" ry="119" /></clipPath>
        <clipPath id={badge}><circle cx="256" cy="256" r={detailed ? 228 : 236} /></clipPath>
        <path
          id={tache}
          d="M256 285 C280 283, 298 276, 315 266 C327 259, 342 258, 344 268 C345 279, 338 289, 326 297 C309 306, 285 313, 256 313 Z"
        />
      </defs>

      <g className={face}>
        <circle cx="256" cy="256" r={detailed ? 248 : 252} fill="#0B0B0F" />
        <circle cx="256" cy="256" r={detailed ? 236 : 244} fill="#FFFFFF" />
        <g clipPath={`url(#${badge})`}>
          <rect x="0" y="0" width="256" height="512" fill="#0085CA" />
          <rect x="256" y="0" width="256" height="512" fill="#FFB612" />
        </g>

        {/* The same centres in both cuts. Anything larger crosses the split
            line, and two heads that touch stop being two heads. */}
        <g transform={at(164, 263, 0.86)}><Face who="doctor" small={!detailed} /></g>
        <g transform={at(348, 263, 0.86)}><Face who="stein" small={!detailed} /></g>
      </g>
    </svg>
  );
}
