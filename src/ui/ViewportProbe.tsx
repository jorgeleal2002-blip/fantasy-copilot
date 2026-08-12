import { useEffect, useState } from 'react';

/* TEMPORARY. Reads what the device actually reports, because an installed iOS
 * copy sizes itself differently from the same page in Safari and the numbers
 * are not reproducible off-device. Remove once the gap is understood. */
export function ViewportProbe() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const read = () => {
      const probe = document.createElement('div');
      probe.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:0', 'height:100dvh',
        'padding-top:env(safe-area-inset-top)', 'padding-bottom:env(safe-area-inset-bottom)',
        'visibility:hidden', 'pointer-events:none',
      ].join(';');
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const dvh = Math.round(probe.getBoundingClientRect().height);
      const safeTop = cs.paddingTop;
      const safeBottom = cs.paddingBottom;
      probe.remove();

      const frame = document.querySelector('.app-frame')?.getBoundingClientRect();
      const nav = document.querySelector('nav')?.getBoundingClientRect();

      setLines([
        `screen ${screen.width}x${screen.height} dpr${devicePixelRatio}`,
        `inner ${innerWidth}x${innerHeight}  client ${document.documentElement.clientHeight}`,
        `visual ${Math.round(visualViewport?.height ?? 0)}  dvh ${dvh}`,
        `safe top ${safeTop} bottom ${safeBottom}`,
        `frame h ${Math.round(frame?.height ?? 0)}  navBottom ${Math.round(nav?.bottom ?? 0)}`,
        `standalone ${matchMedia('(display-mode: standalone)').matches} / ${String((navigator as { standalone?: boolean }).standalone)}`,
      ]);
    };

    read();
    const t = setTimeout(read, 700);
    addEventListener('resize', read);
    return () => { clearTimeout(t); removeEventListener('resize', read); };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'rgba(255,60,60,.92)', color: '#fff',
        font: '600 9.5px/1.35 ui-monospace,Menlo,monospace',
        padding: '3px 5px', pointerEvents: 'none', whiteSpace: 'pre',
      }}
    >
      {lines.join('\n')}
    </div>
  );
}
