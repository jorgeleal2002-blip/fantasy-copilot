import { useId } from 'react';

/**
 * The app mark. Two cuts of one drawing: below 64px the detailed portrait
 * turns to mud, so the simplified sibling takes over automatically — the same
 * handoff rule the identity sheet documents.
 */
export function Mark({ size = 44, title }: { size?: number; title?: string }) {
  // ids have to be unique per instance or a second <Mark> steals the first's clip
  const uid = useId().replace(/:/g, '');
  const head = 'h-' + uid;
  const tache = 't-' + uid;
  const detailed = size >= 64;

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
      {detailed ? (
        <>
          <defs>
            <clipPath id={head}><ellipse cx="256" cy="296" rx="118" ry="140" /></clipPath>
            <path id={tache} d="M256 318 C284 315, 306 307, 326 295 C340 286, 358 284, 360 296 C362 309, 353 322, 338 331 C318 342, 290 350, 256 351 Z" />
          </defs>
          <circle cx="256" cy="256" r="248" fill="#00205B" />
          <circle cx="256" cy="256" r="236" fill="#FFFFFF" />
          <circle cx="256" cy="256" r="228" fill="#C8102E" />
          <circle cx="368" cy="210" r="19" fill="#E4E4EA" />
          <path d="M362 216 C392 230, 404 260, 398 286 C388 270, 372 248, 352 234 Z" fill="#E4E4EA" />
          <g clipPath={`url(#${head})`}>
            <ellipse cx="256" cy="296" rx="118" ry="140" fill="#C98A55" />
            <path d="M256 276 C264 292, 271 310, 271 320 C271 326, 241 326, 241 320 C241 310, 248 292, 256 276 Z" fill="#B67846" />
            <path d="M230 368 Q256 375 282 368" stroke="#8B5A32" strokeWidth="7" strokeLinecap="round" fill="none" />
            <path d="M130 140 H382 V228 Q256 254 130 228 Z" fill="#FFFFFF" />
          </g>
          <path d="M198 260 L240 254 L240 266 L198 270 Z" fill="#4A2C17" />
          <path d="M314 260 L272 254 L272 266 L314 270 Z" fill="#4A2C17" />
          <ellipse cx="220" cy="284" rx="13" ry="10" fill="#2B2B33" />
          <ellipse cx="292" cy="284" rx="13" ry="10" fill="#2B2B33" />
          <g fill="#FFFFFF">
            <use href={`#${tache}`} />
            <use href={`#${tache}`} transform="translate(512,0) scale(-1,1)" />
          </g>
          <path d="M232 170 H280 V182 L257 228 H236 L259 182 H232 Z" fill="#00205B" />
        </>
      ) : (
        <>
          <defs>
            <clipPath id={head}><ellipse cx="256" cy="300" rx="152" ry="176" /></clipPath>
            <path id={tache} d="M256 330 C292 326, 322 316, 348 300 C366 289, 389 286, 392 302 C395 319, 383 337, 363 349 C337 364, 300 374, 256 375 Z" />
          </defs>
          <circle cx="256" cy="256" r="252" fill="#00205B" />
          <circle cx="256" cy="256" r="240" fill="#C8102E" />
          <g clipPath={`url(#${head})`}>
            <ellipse cx="256" cy="300" rx="152" ry="176" fill="#C98A55" />
            <path d="M256 288 C265 304, 273 322, 273 330 C273 335, 239 335, 239 330 C239 322, 247 304, 256 288 Z" fill="#B67846" />
            <path d="M96 110 H416 V236 Q256 268 96 236 Z" fill="#FFFFFF" />
          </g>
          <ellipse cx="204" cy="280" rx="17" ry="14" fill="#2B2B33" />
          <ellipse cx="308" cy="280" rx="17" ry="14" fill="#2B2B33" />
          <g fill="#FFFFFF">
            <use href={`#${tache}`} />
            <use href={`#${tache}`} transform="translate(512,0) scale(-1,1)" />
          </g>
          <path d="M225 148 H291 V164 L259 226 H231 L263 164 H225 Z" fill="#00205B" />
        </>
      )}
    </svg>
  );
}
