// SVG artwork for the graphical surfaces (desktop, VS Code, mobile).
// Every function returns markup that stays identical while its inputs do,
// so an animation inside it keeps running across redraws. The panel has no
// light/dark signal, so colours are mid-tones and fills are translucent:
// they read on either theme.
export const HEX = {
    orange: '#D97757',
    orangeHi: '#FFC9AE',
    purple: '#9F7AEA',
    purpleHi: '#E4D7FF',
    green: '#2EAD66',
    amber: '#DB9A26',
    red: '#E5484D',
    indigo: '#7C8CF8',
    grey: '#8E8E93',
};
const FONT = `font-family="ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif"`;
const MONO = `font-family="ui-monospace, 'Cascadia Code', Consolas, monospace"`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const svg = (w, h, body) => ({
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
    width: w,
    height: h,
});
const spin = (dur) => `<animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="${dur}" repeatCount="indefinite"/>`;
const halo = (color, opacity = 0.14) => `<circle cx="32" cy="32" r="30" fill="${color}" fill-opacity="${opacity}"/>`;
const track = `<circle cx="32" cy="32" r="21" fill="none" stroke="${HEX.grey}" stroke-opacity=".22" stroke-width="4"/>`;
const arc = (color, dur) => `<g>${spin(dur)}<circle cx="32" cy="32" r="21" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="34 98"/></g>`;
export function statusIcon(kind) {
    const S = 64;
    switch (kind) {
        case 'idle':
            return svg(S, S, `${halo(HEX.grey, 0.1)}${track}<circle cx="32" cy="32" r="6" fill="${HEX.grey}"><animate attributeName="opacity" values=".35;.8;.35" dur="4s" repeatCount="indefinite"/></circle>`);
        case 'waiting': {
            const dot = (x, begin) => `<circle cx="${x}" cy="32" r="3" fill="${HEX.indigo}"><animate attributeName="opacity" values=".2;1;.2" dur="1.2s" begin="${begin}" repeatCount="indefinite"/></circle>`;
            return svg(S, S, `${halo(HEX.indigo)}${track}${arc(HEX.indigo, '1.6s')}${dot(24, '0s')}${dot(32, '.2s')}${dot(40, '.4s')}`);
        }
        case 'thinking': {
            const orb = (deg, r, o) => `<circle cx="${32 + 20 * Math.cos((deg * Math.PI) / 180)}" cy="${32 + 20 * Math.sin((deg * Math.PI) / 180)}" r="${r}" fill="${HEX.purple}" fill-opacity="${o}"/>`;
            return svg(S, S, `${halo(HEX.purple)}<circle cx="32" cy="32" r="20" fill="none" stroke="${HEX.purple}" stroke-opacity=".25" stroke-dasharray="2 4"/>` +
                `<g>${spin('2.4s')}${orb(0, 4, 1)}${orb(120, 3.2, 0.7)}${orb(240, 2.5, 0.45)}</g>` +
                `<circle cx="32" cy="32" r="8" fill="${HEX.purple}"><animate attributeName="r" values="7;10;7" dur="1.6s" repeatCount="indefinite"/></circle>`);
        }
        case 'writing': {
            const ripple = (begin) => `<circle cx="32" cy="32" r="10" fill="none" stroke="${HEX.orange}" stroke-width="2"><animate attributeName="r" values="10;28" dur="1.8s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="1.8s" begin="${begin}" repeatCount="indefinite"/></circle>`;
            return svg(S, S, `${halo(HEX.orange)}${ripple('0s')}${ripple('.9s')}<circle cx="32" cy="32" r="10" fill="${HEX.orange}"/>`);
        }
        case 'tool':
        case 'slow': {
            const c = kind === 'tool' ? HEX.orange : HEX.amber;
            return svg(S, S, `${halo(c)}${track}${arc(c, kind === 'tool' ? '1s' : '1.8s')}<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="${c}" ${MONO}>›_</text>`);
        }
        case 'hung':
            return svg(S, S, `<circle cx="32" cy="32" r="30" fill="${HEX.red}" fill-opacity=".14"><animate attributeName="fill-opacity" values=".08;.3;.08" dur="1.4s" repeatCount="indefinite"/></circle>` +
                `<circle cx="32" cy="32" r="21" fill="none" stroke="${HEX.red}" stroke-width="4"><animate attributeName="stroke-opacity" values="1;.35;1" dur="1.4s" repeatCount="indefinite"/></circle>` +
                `<text x="32" y="40" text-anchor="middle" font-size="24" font-weight="800" fill="${HEX.red}" ${FONT}>!</text>`);
        case 'done':
            return svg(S, S, `${halo(HEX.green, 0.18)}<circle cx="32" cy="32" r="21" fill="${HEX.green}"><animate attributeName="r" values="14;23;21" dur=".5s" fill="freeze"/></circle>` +
                `<path d="M22 33 l7 7 l13 -15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="34" stroke-dashoffset="34"><animate attributeName="stroke-dashoffset" from="34" to="0" dur=".45s" begin=".3s" fill="freeze"/></path>`);
        case 'stopped':
            return svg(S, S, `${halo(HEX.amber, 0.18)}<circle cx="32" cy="32" r="21" fill="${HEX.amber}"/><rect x="24" y="23" width="6" height="18" rx="2" fill="#fff"/><rect x="34" y="23" width="6" height="18" rx="2" fill="#fff"/>`);
        case 'error':
            return svg(S, S, `${halo(HEX.red, 0.18)}<circle cx="32" cy="32" r="21" fill="${HEX.red}"/><text x="32" y="41" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" ${FONT}>!</text>`);
    }
}
// ── shimmering file name ───────────────────────────────────────────────────
export function shimmerText(text, color, highlight, size = 13) {
    const w = Math.ceil(text.length * size * 0.62) + 6;
    const h = size + 8;
    return svg(w, h, `<defs><linearGradient id="s" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0">` +
        `<stop offset="0" stop-color="${color}"/><stop offset=".38" stop-color="${color}"/><stop offset=".5" stop-color="${highlight}"/><stop offset=".62" stop-color="${color}"/><stop offset="1" stop-color="${color}"/>` +
        `<animateTransform attributeName="gradientTransform" type="translate" values="${-w} 0;${w} 0" dur="1.7s" repeatCount="indefinite"/>` +
        `</linearGradient></defs>` +
        `<text x="1" y="${size + 2}" font-size="${size}" font-weight="650" fill="url(#s)" ${FONT}>${esc(text)}</text>`);
}
// ── pills ──────────────────────────────────────────────────────────────────
export function pill(label, color, options = {}) {
    const h = 20;
    const textW = Math.ceil(label.length * 6.7);
    const lead = options.pulse ? 18 : 9;
    const w = textW + lead + 9;
    const fg = options.solid ? '#fff' : color;
    const dot = options.pulse
        ? `<circle cx="10" cy="10" r="3.5" fill="${fg}"><animate attributeName="opacity" values="1;.3;1" dur="1.1s" repeatCount="indefinite"/></circle>` +
            `<circle cx="10" cy="10" r="3.5" fill="none" stroke="${fg}"><animate attributeName="r" values="3.5;8" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0" dur="1.1s" repeatCount="indefinite"/></circle>`
        : '';
    return svg(w, h, `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${(h - 1) / 2}" fill="${color}" fill-opacity="${options.solid ? 0.95 : 0.16}" stroke="${color}" stroke-opacity="${options.solid ? 0 : 0.4}"/>` +
        dot +
        `<text x="${lead}" y="14" font-size="11" font-weight="650" fill="${fg}" ${FONT}>${esc(label)}</text>`);
}
// ── file-type chip ─────────────────────────────────────────────────────────
const EXT_COLORS = [
    [/^(js|jsx|mjs|cjs)$/, '#E8C534', '#1d1d1f'],
    [/^(ts|tsx|mts|cts)$/, '#3178C6', '#fff'],
    [/^(py|pyw)$/, '#3B78A8', '#fff'],
    [/^(json|jsonc|yml|yaml|toml)$/, '#C98A2E', '#fff'],
    [/^(md|mdx|txt|rst)$/, '#7A7A80', '#fff'],
    [/^pdf$/, '#E5484D', '#fff'],
    [/^(csv|tsv|xls|xlsx)$/, '#2FA35A', '#fff'],
    [/^(html|htm|xml)$/, '#E06A3B', '#fff'],
    [/^(css|scss|sass|less)$/, '#6E5BD8', '#fff'],
    [/^(ps1|sh|bash|bat|cmd|zsh)$/, '#4A8F5A', '#fff'],
    [/^(png|jpg|jpeg|gif|svg|webp|ico)$/, '#B46ACF', '#fff'],
    [/^(go|rs|java|kt|c|cpp|h|cs|rb|php|swift)$/, '#5C6BC0', '#fff'],
];
export function extOf(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
export function fileChip(name) {
    const ext = extOf(name);
    const label = ext === '' ? '·' : ext.length > 4 ? ext.slice(0, 4) : ext;
    const [, bg, fg] = EXT_COLORS.find(([re]) => re.test(ext)) ?? [null, HEX.grey, '#fff'];
    return svg(30, 16, `<rect width="30" height="16" rx="4" fill="${bg}" fill-opacity=".92"/><text x="15" y="11.5" text-anchor="middle" font-size="8.5" font-weight="800" fill="${fg}" letter-spacing=".3" ${FONT}>${esc(label.toUpperCase())}</text>`);
}
export function folderIcon(isOpen, color) {
    const body = isOpen
        ? `<path d="M1.5 4.5 a1.5 1.5 0 0 1 1.5 -1.5 h3.6 l1.6 1.8 h6.3 a1.5 1.5 0 0 1 1.5 1.5 v.7 h-12.6 l-1.9 6.5 z" fill="${color}" fill-opacity=".55"/><path d="M3.3 6.7 h13.2 l-2 7 a1.2 1.2 0 0 1 -1.1 .8 h-11.9 z" fill="${color}"/>`
        : `<path d="M1.5 4.5 a1.5 1.5 0 0 1 1.5 -1.5 h3.6 l1.6 1.8 h6.3 a1.5 1.5 0 0 1 1.5 1.5 v6.9 a1.5 1.5 0 0 1 -1.5 1.5 h-11.5 a1.5 1.5 0 0 1 -1.5 -1.5 z" fill="${color}"/>`;
    return svg(18, 16, body);
}
// ── progress toward a command's timeout ────────────────────────────────────
/** A static bar; quantised to whole percents so it redraws about once a second at most. */
export function timeoutBar(width, fraction) {
    const w = Math.max(60, Math.round(width));
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    const color = pct >= 75 ? HEX.red : pct >= 50 ? HEX.amber : HEX.orange;
    const fill = Math.max(6, Math.round((w * pct) / 100));
    return svg(w, 8, `<defs><linearGradient id="b" x1="0" x2="1"><stop offset="0" stop-color="${HEX.orange}"/><stop offset="1" stop-color="${color}"/></linearGradient>` +
        `<linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
        `<clipPath id="c"><rect width="${fill}" height="8" rx="4"/></clipPath></defs>` +
        `<rect width="${w}" height="8" rx="4" fill="${HEX.grey}" fill-opacity=".2"/>` +
        `<rect width="${fill}" height="8" rx="4" fill="url(#b)"/>` +
        `<g clip-path="url(#c)"><rect x="-40" width="40" height="8" fill="url(#gl)"><animate attributeName="x" values="-40;${fill}" dur="1.6s" repeatCount="indefinite"/></rect></g>`);
}
/** For work with no timeout (a subagent, a background command): a sweeping segment. */
export function sweepBar(width, color) {
    const w = Math.max(60, Math.round(width));
    const seg = Math.round(w * 0.28);
    return svg(w, 8, `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset=".5" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient><clipPath id="c"><rect width="${w}" height="8" rx="4"/></clipPath></defs>` +
        `<rect width="${w}" height="8" rx="4" fill="${HEX.grey}" fill-opacity=".2"/>` +
        `<g clip-path="url(#c)"><rect x="${-seg}" width="${seg}" height="8" fill="url(#g)"><animate attributeName="x" values="${-seg};${w}" dur="1.4s" repeatCount="indefinite"/></rect></g>`);
}
