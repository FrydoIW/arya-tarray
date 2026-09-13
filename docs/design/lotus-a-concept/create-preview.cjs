// Standalone SVG proposal. This does not change the application logo.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

function emblem(blue, gold) {
  return `<g fill="${blue}">
    <path d="M14 99C53 100 82 124 99 171C52 169 21 145 14 99Z"/>
    <path d="M226 99C187 100 158 124 141 171C188 169 219 145 226 99Z"/>
  </g>
  <path fill="${gold}" fill-rule="evenodd" d="M120 18C100 43 83 77 83 106C83 123 89 138 99 152L109 124H131L141 152C151 138 157 123 157 106C157 77 140 43 120 18ZM120 66L105 111H135L120 66Z"/>`;
}

const light = emblem('#163A65', '#C89C41');
const dark = emblem('#BBD6FF', '#E4BC65');
for (const [name, content] of [['lotus-a-light', light], ['lotus-a-dark', dark]]) {
  fs.writeFileSync(path.join(__dirname, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 192" fill="none"><title>Arya Tarray — Lotus A concept</title>${content}</svg>\n`);
}

const board = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <rect width="1600" height="1000" fill="#F2F4F8"/>
  <g font-family="Segoe UI, sans-serif">
    <text x="64" y="59" fill="#71819A" font-size="13" letter-spacing="3">ARYA TARRAY / IDENTITAS VISUAL</text>
    <text x="64" y="121" fill="#162D4D" font-size="42" font-weight="600" letter-spacing="-1">Lotus + A</text>
    <text x="1536" y="113" text-anchor="end" fill="#71819A" font-size="14">KONSEP 01 — PREVIEW</text>
    <rect x="64" y="160" width="720" height="626" rx="20" fill="#FFFFFF"/>
    <rect x="816" y="160" width="720" height="626" rx="20" fill="#101F3D"/>
    <text x="98" y="205" fill="#71819A" font-size="11" letter-spacing="2">NAVY / GOLD</text>
    <text x="850" y="205" fill="#91A8C9" font-size="11" letter-spacing="2">ICE BLUE / GOLD</text>
    <g transform="translate(256 242) scale(1.4)">${light}</g>
    <g transform="translate(1008 242) scale(1.4)">${dark}</g>
    <text x="424" y="571" text-anchor="middle" fill="#163A65" font-size="38" font-weight="600" letter-spacing="-.8">Arya Tarray</text>
    <text x="424" y="604" text-anchor="middle" fill="#7187A2" font-size="12" font-weight="600" letter-spacing="5">NUSANTARA</text>
    <text x="1176" y="571" text-anchor="middle" fill="#F5F8FF" font-size="38" font-weight="600" letter-spacing="-.8">Arya Tarray</text>
    <text x="1176" y="604" text-anchor="middle" fill="#96ACCC" font-size="12" font-weight="600" letter-spacing="5">NUSANTARA</text>
    <path d="M100 650H748" stroke="#E7ECF3"/>
    <path d="M852 650H1500" stroke="#FFFFFF" stroke-opacity=".1"/>
    <g transform="translate(110 683) scale(.3)">${light}</g>
    <text x="201" y="710" fill="#163A65" font-size="22" font-weight="600">Arya Tarray</text>
    <text x="202" y="731" fill="#7187A2" font-size="8" font-weight="600" letter-spacing="3">NUSANTARA</text>
    <text x="748" y="720" text-anchor="end" fill="#8D9AB0" font-size="10">UKURAN HEADER</text>
    <g transform="translate(862 683) scale(.3)">${dark}</g>
    <text x="953" y="710" fill="#F5F8FF" font-size="22" font-weight="600">Arya Tarray</text>
    <text x="954" y="731" fill="#96ACCC" font-size="8" font-weight="600" letter-spacing="3">NUSANTARA</text>
    <text x="1500" y="720" text-anchor="end" fill="#8197B9" font-size="10">UKURAN SIDEBAR</text>
    <text x="64" y="850" fill="#163A65" font-size="18" font-weight="600">Tiga kelopak. Satu identitas.</text>
    <text x="64" y="882" fill="#71819A" font-size="15">Huruf A menyatu di kelopak tengah; siluet sederhana tetap terbaca saat kecil.</text>
    <text x="64" y="948" fill="#8A98AC" font-size="12">SVG VEKTOR ASLI · LATAR LOGO TRANSPARAN · BELUM DITERAPKAN KE APLIKASI</text>
    <g transform="translate(1286 838) scale(.23)">${emblem('#163A65', '#163A65')}</g>
    <g transform="translate(1372 840) scale(.17)">${emblem('#163A65', '#163A65')}</g>
    <g transform="translate(1448 844) scale(.12)">${emblem('#163A65', '#163A65')}</g>
    <text x="1500" y="921" text-anchor="end" fill="#8A98AC" font-size="10" letter-spacing="1">SILUET MONOKROM</text>
  </g>
</svg>`;
fs.writeFileSync(path.join(__dirname, 'preview.svg'), board);
sharp(Buffer.from(board)).resize(3200, 2000).png().toFile(path.join(__dirname, 'preview.png'));
