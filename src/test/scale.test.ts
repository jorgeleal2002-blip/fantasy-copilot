/**
 * The scales, enforced against the source tree itself.
 *
 * A scale that is only written down is not a scale. This app had 28 font sizes,
 * 17 corner radii and 18 text tints, every one of them added by somebody
 * reasonable who needed a label slightly smaller than the one next to it. The
 * only thing that stops that is a test that reads the files and refuses.
 *
 * It reads the source rather than a rendered page on purpose: a rendered page
 * only shows the screens the test happens to mount, and the twenty-ninth font
 * size will be on the one it does not.
 *
 * Off the disk rather than through Vite's `import.meta.glob`, which was tried
 * first and cannot do it: a stylesheet reached that way comes back as an empty
 * string here, because CSS leaves the module graph through the style pipeline
 * rather than as text. A glob would have checked the TypeScript and quietly
 * passed every stylesheet in the app — and the stylesheets are where two thirds
 * of the sizes live.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALPHA_STEPS, FS_STEPS, GROUNDS, INK, R_STEPS, T, TEXT_CONTRAST_MIN, W } from '../ui/scale';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything the app ships, minus the tests and the scale's own definition. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'test') sources(path, out);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(name)) continue;
    if (name === 'scale.ts') continue;
    out.push(path);
  }
  return out;
}

/**
 * Comments are stripped before anything is counted. Every one of these checks
 * exists because a value was wrong, and the place that explains why a value was
 * wrong has to quote it — a scale test that fails on its own rationale teaches
 * people to stop writing the rationale.
 */
const strip = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');

const FILES = sources(ROOT).map(path => ({
  path: path.slice(ROOT.length + 1),
  text: strip(readFileSync(path, 'utf8')),
}));

/** Every match of `re`'s first group, as a number, with the file it is in. */
function found(re: RegExp): { where: string; value: number; text: string }[] {
  const out: { where: string; value: number; text: string }[] = [];
  for (const f of FILES) {
    for (const m of f.text.matchAll(re)) {
      out.push({ where: f.path, value: Number(m[1]), text: m[0] });
    }
  }
  return out;
}

/** What a failure has to say to be worth anything: which value, and where. */
const offenders = (
  hits: { where: string; value: number; text: string }[],
  steps: number[],
) => {
  const bad = hits.filter(h => Number.isFinite(h.value) && steps.indexOf(h.value) < 0);
  const seen = new Map<string, string[]>();
  bad.forEach(h => seen.set(h.text, [...(seen.get(h.text) || []), h.where]));
  return [...seen.entries()].map(([text, where]) =>
    `${text} in ${[...new Set(where)].join(', ')}`);
};

describe('the app is drawn on its scales', () => {
  it('finds the source to check, so a green run means something', () => {
    // A pass with nothing found is the failure mode this whole file has.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some(f => f.path.endsWith('.css'))).toBe(true);
    expect(found(/fontSize: (\d+(?:\.\d+)?)/g).length).toBeGreaterThan(100);
    expect(found(/font-size: (\d+(?:\.\d+)?)px/g).length).toBeGreaterThan(30);
    expect(found(/dim\((\d*\.?\d+)\)/g).length).toBeGreaterThan(100);
  });

  it('sets every font size to a step of the type scale', () => {
    expect(offenders(found(/fontSize: (\d+(?:\.\d+)?)/g), FS_STEPS)).toEqual([]);
    expect(offenders(found(/font-size: (\d+(?:\.\d+)?)px/g), FS_STEPS)).toEqual([]);
  });

  it('writes every font size in whole pixels', () => {
    // Half a pixel of type is half a pixel of line box, and every rule and
    // background edge in that row then lands between two device pixels.
    expect(FS_STEPS.filter(v => !Number.isInteger(v))).toEqual([]);
  });

  it('rounds every corner to a step of the radius scale', () => {
    expect(offenders(found(/borderRadius: (\d+(?:\.\d+)?)/g), R_STEPS)).toEqual([]);
    // `var(--radius-*)` is the same scale by another name, so only literals here.
    expect(offenders(found(/border-radius: (\d+(?:\.\d+)?)px/g), R_STEPS)).toEqual([]);
  });

  it('tints every piece of text at a step of the tint scale', () => {
    // The near-white ramp only. A filled draft cell writes dark ink on a pastel
    // and that is a second ramp with its own steps, not a stray tint of this one.
    expect(offenders(found(/dim\((\d*\.?\d+)\)/g), ALPHA_STEPS)).toEqual([]);
    expect(offenders(
      found(/rgba\(242,\s*253,\s*254,\s*(\d*\.?\d+)\)/g), ALPHA_STEPS,
    )).toEqual([]);
  });

  it('never computes a size or a corner from something else', () => {
    /* The hole the checks above had. They read `fontSize: 13`, so
       `fontSize: size * 0.3` was invisible to them — and that one expression
       produced a different, fractional size for every width the avatar was ever
       drawn at. A value that is not a step of the scale, a token, a percentage
       or a choice between steps is not on the scale, whatever it evaluates to.
       Anything new that fails here belongs in `scale.ts` as a named band. */
    const ok = (v: string): boolean => {
      const t = v.trim();
      if (/^\d+(\.\d+)?$/.test(t)) return true;                    // a literal, checked above
      if (/^'(50%|100%|\d+px)'$/.test(t)) return true;              // a circle, or whole pixels
      if (/^var\(--[a-z-]+\)$/.test(t)) return true;               // a token
      if (/^(FS|R)\.[a-z]+$/i.test(t)) return true;                // the scale, named
      if (/^(boxType|boxRadius)\(/.test(t)) return true;           // a named band of it
      // A ternary is fine as long as both arms are.
      const arms = t.match(/^[^?]+\?([^:]+):(.+)$/);
      if (arms) return ok(arms[1] as string) && ok(arms[2] as string);
      return false;
    };
    const bad: string[] = [];
    for (const f of FILES) {
      if (f.path.endsWith('.css')) continue;
      for (const m of f.text.matchAll(/\b(fontSize|borderRadius): ([^,\n}]+)/g)) {
        if (!ok(m[2] as string)) bad.push(`${m[1]}: ${(m[2] as string).trim()} in ${f.path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has one near-white, not two', () => {
    /* There were two. `#f2fdfe` is the token — a white with a cyan cast, sampled
       from the app this look comes from — and `#e9e9ed`, a neutral grey-white
       left over from the palette before it, was inlined 48 times across seven
       files with 22 alphas of its own. Two whites a couple of per cent apart are
       invisible alone and plainly different side by side, which on a list of
       rows is where they always are. */
    const whites = new Set<string>();
    for (const f of FILES) {
      for (const m of f.text.matchAll(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),/g)) {
        const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
        if (r > 200 && g > 200 && b > 200) whites.add(`${r},${g},${b}`);
      }
    }
    expect([...whites]).toEqual(['242,253,254']);
  });

  /* Contrast, computed rather than judged. Three of the six tints in the scale
     before this one could not be read — 1.9, 2.4 and 3.2 to one against a hero
     card, where 4.5 is the floor for body text — and they were the ones
     carrying the numbers and names. A glyph edge at 2.4:1 has almost no range
     for a screen to antialias into, so it smears into the ground however many
     pixels the phone has, which is what "it doesn't look sharp" was. */
  const luminance = ([r, g, b]: [number, number, number]) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (alpha: number, ground: [number, number, number]) => {
    const over = ground.map((c, i) => INK[i] * alpha + c * (1 - alpha)) as [number, number, number];
    const [hi, lo] = [luminance(over), luminance(ground)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it('can be read on every ground the app paints on', () => {
    const failing: string[] = [];
    for (const [name, alpha] of Object.entries(T)) {
      for (const ground of GROUNDS) {
        const c = contrast(alpha, ground);
        if (c < TEXT_CONTRAST_MIN) {
          failing.push(`T.${name} (${alpha}) is ${c.toFixed(1)}:1 on rgb(${ground.join(',')})`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it('keeps the marks below the text floor, so the split means something', () => {
    // If a wash ever clears the floor it stops being a wash, and the next
    // person to need a dim label will reach for it.
    const tooBright = Object.entries(W).filter(
      ([, a]) => contrast(a, GROUNDS[0] as [number, number, number]) >= TEXT_CONTRAST_MIN);
    expect(tooBright).toEqual([]);
    // And the dimmest text has to be brighter than the brightest mark.
    expect(Math.min(...Object.values(T))).toBeGreaterThan(Math.max(...Object.values(W)));
  });

  it('never paints a word with a tint meant for a mark', () => {
    const marks = Object.values(W) as number[];
    const bad: string[] = [];
    for (const f of FILES) {
      for (const m of f.text.matchAll(
        /\b(color|webkitTextFillColor): (?:dim\(|rgba\(242,\s*253,\s*254,\s*)([0-9.]+)/g)) {
        if (marks.indexOf(Number(m[2])) >= 0) bad.push(`${m[0]} in ${f.path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps the scales small enough to hold in your head', () => {
    // The number that matters. Whatever the steps are, there cannot be many.
    expect(FS_STEPS.length).toBeLessThanOrEqual(9);
    expect(R_STEPS.length).toBeLessThanOrEqual(6);
    expect(ALPHA_STEPS.length).toBeLessThanOrEqual(9);
  });

  it('never sets type below the size a phone can render', () => {
    // Seven pixels is not small text, it is a texture that used to say LIVE.
    expect(Math.min(...FS_STEPS)).toBeGreaterThanOrEqual(10);
  });

  it('spaces on whole pixels too', () => {
    // The tokens arrived as a 14px base cut into fifths — 2.8, 5.6, 8.4, 11.2 —
    // and every edge they padded fell between two device pixels.
    const tokens = FILES.find(f => f.path.endsWith('tokens.css'));
    expect(tokens).toBeTruthy();
    const spaces = [...(tokens as { text: string }).text
      .matchAll(/--space-\d+: (\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(spaces.length).toBeGreaterThan(3);
    expect(spaces.filter(v => !Number.isInteger(v))).toEqual([]);
  });

  it('leaves no fractional pixel anywhere in the stylesheets', () => {
    // Except the hairline, which is deliberately half of one: that is a line a
    // retina screen can draw, and a padding is not.
    const bad: string[] = [];
    for (const f of FILES) {
      if (!f.path.endsWith('.css')) continue;
      for (const m of f.text.matchAll(/(\d+\.\d+)px/g)) {
        if (m[1] === '0.5') continue;
        bad.push(m[0] + ' in ' + f.path);
      }
    }
    expect(bad).toEqual([]);
  });
});
