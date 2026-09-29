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
import { ACCENT, BAD, GOOD, MARK_BAD, MARK_GOOD, MARK_MID, MARK_NONE, MID, POS_COLOR, WARN } from '../model/constants';
import { placeColor, placeMark } from '../ui/styles';

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

  it('reads the meaning colours as well as the grey ones', () => {
    /* The tint scale was checked and the hues were not, though green and salmon
       carry the verdict on every figure the app has an opinion about. */
    const hex = (h: string) =>
      [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    const over = (c: [number, number, number], g: [number, number, number]) => {
      const [hi, lo] = [luminance(c), luminance(g)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const failing: string[] = [];
    for (const [name, h] of Object.entries({ GOOD, BAD, MID, WARN, ACCENT })) {
      for (const ground of GROUNDS) {
        const c = over(hex(h), ground);
        if (c < TEXT_CONTRAST_MIN) failing.push(`${name} is ${c.toFixed(1)}:1 on rgb(${ground.join(',')})`);
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

  it('keeps the smallest step for text that can survive it', () => {
    /* `FS.micro` is for uppercase, numerals and glyphs — see its note. It had
       become the app's general small size instead, on 41 rules, including the
       line naming which player a row is about. A rule that sets it has to say
       it is one of those: uppercase, or numeric. */
    const css = FILES.filter(f => f.path.endsWith('.css'));
    const bad: string[] = [];
    for (const f of css) {
      for (const m of f.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2] as string;
        if (!/font-size: 10px/.test(body)) continue;
        if (/text-transform: uppercase/.test(body)) continue;
        if (/font-variant-numeric: tabular-nums/.test(body)) continue;
        bad.push((m[1] as string).trim().split('\n').pop() as string);
      }
    }
    // Each remaining one holds a glyph or a bare code and is listed by name,
    // so adding to this list is a decision somebody has to write down.
    const GLYPHS = ['.bd-live', '.bd-arrow', '.bd-pos', '.bd-head', '.bd-round',
      '.pos-count', '.ms-slot', '.ms-edge', '.fb-pill', '.pw-tag', '.ps-bar-n'];
    expect(bad.filter(sel => !GLYPHS.some(g => sel.includes(g)))).toEqual([]);
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

/* One screen showed the same blue-violet on "2nd of twelve" at the top and
   "8th of twelve" four hundred pixels below, because four different places were
   each deciding what colour a rank is and none of them agreed. */
describe('what colour a placing is', () => {
  it('is green near the top and salmon near the bottom', () => {
    expect(placeColor(1, 12)).toBe(GOOD);
    expect(placeColor(2, 12)).toBe(GOOD);
    expect(placeColor(12, 12)).toBe(BAD);
    expect(placeColor(11, 12)).toBe(BAD);
  });

  it('leaves the middle alone, because being ordinary is not news', () => {
    expect(placeColor(6, 12)).toBeUndefined();
    expect(placeColor(7, 12)).toBeUndefined();
  });

  it('never says the same thing about second and eighth', () => {
    // The collision itself, in the league size it was found in.
    expect(placeColor(2, 12)).not.toBe(placeColor(8, 12));
  });

  it('never paints a rank with the middle-of-a-category colour', () => {
    // MID still means something real — a league table's contending / middling /
    // rebuilding is a category, and its middle IS a state. A placing's middle
    // is not, and this is what made one colour mean both.
    for (const of of [4, 8, 10, 12, 14]) {
      for (let r = 1; r <= of; r++) expect(placeColor(r, of)).not.toBe(MID);
    }
  });

  it('answers with nothing rather than guessing', () => {
    expect(placeColor(0, 12)).toBeUndefined();
    expect(placeColor(null, 12)).toBeUndefined();
    expect(placeColor(3, null)).toBeUndefined();
    // A field of one: being the only one is neither good nor bad.
    expect(placeColor(1, 1)).toBeUndefined();
  });

  it('gives a bar the same verdict, and a neutral where there is none', () => {
    // A number in the middle band can go uncoloured. A bar cannot.
    expect(placeMark(1, 12)).toBe('good');
    expect(placeMark(12, 12)).toBe('bad');
    expect(placeMark(6, 12)).toBe('none');
    expect(placeMark(null, 12)).toBe('none');
  });

  it('is not re-decided anywhere else in the app', () => {
    // The shape that was copied into three screens. If it comes back, so does
    // the disagreement.
    const bad: string[] = [];
    for (const f of FILES) {
      if (!/\.tsx?$/.test(f.path)) continue;
      if (/leagueRows\.length - 2/.test(f.text)) bad.push(f.path);
      if (/mine <= 3|rank <= 3/.test(f.text)) bad.push(f.path);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/* "Los colores le faltan brillo." They did, and it was measurable: every hue
   the app used to state a meaning sat at about half the chroma of the app this
   look is taken from — Sleeper's green is 64, this one was 28 — while the four
   position colours, which nobody had ever muted, were already at 42 to 76. The
   semantic set was the only dull thing in the palette, and it was the set
   carrying every verdict. */
describe('the palette carries its colour', () => {
  const hex = (h: string) =>
    [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

  const labOf = (c: [number, number, number]): [number, number, number] => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = c.map(f) as [number, number, number];
    const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const [fx, fy, fz] = [t(X), t(Y), t(Z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };

  /** Chroma: how much colour is left once lightness and hue are set aside. */
  const chroma = (h: string) => {
    const [, a, b] = labOf(hex(h));
    return Math.sqrt(a * a + b * b);
  };

  const dE = (x: string, y: string) => {
    const [p, q] = [labOf(hex(x)), labOf(hex(y))];
    return Math.sqrt(p.reduce((acc, v, i) => acc + (v - (q[i] as number)) ** 2, 0));
  };

  /** Below this a hue is a grey with an opinion. The position colours, which
   *  were never muted, sit at 42 and up; the verdict hues now join them. */
  const CHROMA_MIN = 40;

  it('names a colour instead of writing it down again', () => {
    /* The check this file was missing. The chroma tests above read the palette's
       DEFINITION, so when the greens were raised they passed — while nine places
       across six files went on painting the old muted ones, because they had
       copied the hex instead of naming it. The matchup bar was the visible one,
       under a comment reading "the same green the rest of the app calls good",
       which by then it was not.

       Three files may hold colour literals and each has a reason: the two that
       ARE the palette, and the map of NFL team colours, which belong to the
       teams rather than to this app. The meme overlay keeps its own tints. */
    const ALLOWED = ['model/constants.ts', 'styles/tokens.css', 'ui/Mark.tsx', 'ui/brainrot.tsx'];
    const stray: string[] = [];
    for (const f of FILES) {
      if (ALLOWED.some(a => f.path.endsWith(a))) continue;
      for (const m of f.text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        stray.push(`${m[0]} in ${f.path}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('paints a fill with a fill step and a letter with a text step', () => {
    /* There are two steps of every state because a colour dark enough to be a
       good mark on a dark surface is too dark to be small type on it, and the
       note in constants.ts says what happens the other way round: a text step
       painted as a chart mark "came out washed". The matchup bar was exactly
       that — the light green, four pixels tall across a card — and it looked it.
       Nothing had ever checked which step a declaration reached for. */
    const TEXT = ['--c-good', '--c-bad', '--c-warn', '--c-mid'];
    const FILL = ['--c-mark-good', '--c-mark-bad', '--c-mark-mid', '--c-mark-none'];
    const wrong: string[] = [];
    for (const f of FILES) {
      if (!f.path.endsWith('.css')) continue;
      for (const m of f.text.matchAll(/(background|background-color|color): var\((--c-[a-z-]+)\)/g)) {
        const [prop, token] = [m[1] as string, m[2] as string];
        const fills = prop !== 'color';
        if (fills && TEXT.indexOf(token) >= 0) wrong.push(`${prop}: ${token} in ${f.path}`);
        if (!fills && FILL.indexOf(token) >= 0) wrong.push(`${prop}: ${token} in ${f.path}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('states each verdict hue once, however many files need it', () => {
    /* The stylesheet needs the same greens the TypeScript does, and a value
       written in two places is a value that drifts. */
    const tokens = FILES.find(f => f.path.endsWith('tokens.css'));
    expect(tokens).toBeTruthy();
    const read = (name: string) => {
      const m = (tokens as { text: string }).text.match(
        new RegExp('--c-' + name + ': *(#[0-9a-f]{6})'));
      return m ? (m[1] as string) : null;
    };
    expect(read('good')).toBe(GOOD);
    expect(read('bad')).toBe(BAD);
    expect(read('warn')).toBe(WARN);
    expect(read('mid')).toBe(MID);
    expect(read('mark-good')).toBe(MARK_GOOD);
    expect(read('mark-mid')).toBe(MARK_MID);
    expect(read('mark-bad')).toBe(MARK_BAD);
    expect(read('mark-none')).toBe(MARK_NONE);
  });

  it('keeps every meaning hue above the floor', () => {
    const dull = Object.entries({ ACCENT, GOOD, BAD, WARN, MID, MARK_GOOD, MARK_MID, MARK_BAD })
      .filter(([, h]) => chroma(h) < CHROMA_MIN)
      .map(([n, h]) => `${n} ${h} is chroma ${chroma(h).toFixed(0)}`);
    expect(dull).toEqual([]);
  });

  it('keeps the position hues there too, which they always were', () => {
    const dull = Object.entries(POS_COLOR)
      .filter(([, h]) => chroma(h) < CHROMA_MIN)
      .map(([n, h]) => `${n} ${h} is chroma ${chroma(h).toFixed(0)}`);
    expect(dull).toEqual([]);
  });

  it('does not buy the colour back by letting two of them converge', () => {
    // Chroma without separation is a brighter mess. The muted set had pairs at
    // ΔE 24; this one has none under 30.
    const set = { ACCENT, GOOD, BAD, WARN, MID };
    const names = Object.keys(set);
    const close: string[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i] as string, names[j] as string];
        const d = dE(set[a as keyof typeof set], set[b as keyof typeof set]);
        if (d < 30) close.push(`${a} vs ${b} is ${d.toFixed(0)}`);
      }
    }
    expect(close).toEqual([]);
  });
});
