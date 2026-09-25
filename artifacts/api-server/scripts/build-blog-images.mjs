/** Reproducible original vector artwork. No stock photos, remote logos or fonts. */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(
  new URL("../../megaradio/public/images/blog/", import.meta.url),
);
await mkdir(output, { recursive: true });
const headphone =
  '<path d="M-95 30v-65a95 95 0 0 1 190 0v65"/><rect x="-112" y="-12" width="38" height="88" rx="18" fill="var(--accent)"/><rect x="74" y="-12" width="38" height="88" rx="18" fill="var(--accent)"/>';
const guitar = (electric = false) =>
  `<g transform="rotate(36)"><path d="M-21 -155h42l-5 142c${electric ? "58 -34 75 32 38 67l-3 52-47-10-39 27-25-39c-51-30-37-87 23-67" : "45 -22 66 18 38 46 67 57 34 113-54 98-82-19-76-71-29-103-34-26-12-67 26-41"}Z" fill="var(--accent)"/><path d="M-8 -140v213M8 -140v213" stroke="#17171e" stroke-width="5"/><circle cy="36" r="23" fill="#17171e" stroke="none"/><path d="M-30 96h60" stroke="#17171e"/><path d="M-32 -134h64m-64 22h64"/></g>`;
const compositions = [
  [
    "listen-to-radio-online",
    "#ff4199",
    `<rect x="-172" y="-73" width="290" height="176" rx="24" fill="#32313f"/><path d="M-128-74l119-88"/><rect x="-144" y="-38" width="146" height="25" rx="8" fill="var(--accent)" stroke="none"/><path d="M-130 17h130m-130 25h130m-130 25h130" stroke="#777383"/><circle cx="63" cy="39" r="28" fill="var(--accent)"/><g transform="translate(135,-20) scale(.8)">${headphone}</g>`,
  ],
  [
    "internet-radio-explained",
    "#54d5c4",
    '<circle r="124" fill="#173b3c"/><ellipse rx="56" ry="124"/><path d="M-124 0h248M-110-55h220m-220 110h220"/><g transform="translate(153,-108)"><path d="M-48 12q48-48 96 0m-77 26q29-29 58 0" stroke="var(--accent)"/><circle cy="65" r="8" fill="var(--accent)" stroke="none"/></g>',
  ],
  [
    "radio-app-iphone-android",
    "#9792ff",
    `<rect x="-145" y="-165" width="173" height="326" rx="30" fill="#333047"/><path d="M-95-141h74m-60 277h47"/><rect x="-120" y="-100" width="123" height="138" rx="14" fill="var(--accent)" stroke="none"/><path d="M-66-65v64l46-32Z" fill="#17171e" stroke="none"/><circle cx="-58" cy="87" r="17"/><g transform="translate(133,19) scale(.82)">${headphone}</g>`,
  ],
  [
    "radio-data-usage",
    "#5ec3ff",
    '<rect x="-170" y="55" width="42" height="64" rx="8" fill="#285c78" stroke="none"/><rect x="-100" y="10" width="42" height="109" rx="8" fill="#3986b1" stroke="none"/><rect x="-30" y="-48" width="42" height="167" rx="8" fill="var(--accent)" stroke="none"/><path d="M45 100a108 108 0 1 1 147 0"/><path d="M112 18l53-60" stroke="var(--accent)"/><circle cx="112" cy="18" r="14" fill="var(--accent)"/><path d="M-168-114q64-64 128 0m-108 29q44-44 88 0" stroke="#5ec3ff"/>',
  ],
  ["rock-radio-guide", "#ff657c", guitar(true)],
  [
    "jazz-radio-guide",
    "#ffc36a",
    '<path d="M-10-147h66v30H23v142q0 90-83 90-72 0-76-79l4-27 59 14-5 20q2 23 21 23 21 0 21-35V-75q0-46 26-72Z" fill="var(--accent)"/><path d="M-80 24l-72-15 10-36 75 11Z" fill="#d68b3e"/><path d="M-21-86h33m-39 30h39m-39 30h39" stroke="#17171e"/><path d="M105-35v91m0-80 57-15v80"/><ellipse cx="91" cy="59" rx="18" ry="11" fill="var(--accent)"/><ellipse cx="148" cy="44" rx="18" ry="11" fill="var(--accent)"/>',
  ],
  [
    "blues-radio-guide",
    "#6eacff",
    `<g transform="translate(105,20)"><circle r="124" fill="#242b41"/><circle r="97" stroke="#48567c"/><circle r="78" stroke="#48567c"/><circle r="42" fill="var(--accent)"/><circle r="9" fill="#17171e"/></g><g transform="translate(-90,0) scale(.9)">${guitar()}</g>`,
  ],
  ["country-radio-guide", "#d3af76", guitar()],
  [
    "news-talk-radio-guide",
    "#74d4ab",
    '<rect x="-48" y="-159" width="96" height="194" rx="48" fill="var(--accent)"/><path d="M-86-40v30a86 86 0 0 0 172 0v-30M0 76v65m-54 0H54"/><path d="M-27-123h54m-60 25h66m-66 25h66m-60 25h54" stroke="#17171e"/><path d="M-152-84q-37 49 0 96M152-84q37 49 0 96m-337-121q-62 75 0 145m217-145q62 75 0 145" stroke="#74d4ab"/>',
  ],
  [
    "80s-90s-radio-guide",
    "#ec86e4",
    '<rect x="-190" y="-118" width="380" height="240" rx="24" fill="#47334d"/><rect x="-158" y="-86" width="316" height="139" rx="12" fill="var(--accent)" stroke="none"/><rect x="-119" y="-54" width="238" height="73" rx="36" fill="#22212e"/><circle cx="-78" cy="-18" r="25"/><circle cx="78" cy="-18" r="25"/><path d="M-103 119l23-48H80l23 48"/><circle cx="-159" cy="91" r="6"/><circle cx="159" cy="91" r="6"/>',
  ],
];
for (let i = 0; i < compositions.length; i++) {
  const [id, accent, drawing] = compositions[i];
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><radialGradient id="halo"><stop stop-color="${accent}" stop-opacity=".2"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern></defs><rect width="1200" height="630" fill="#101016"/><rect width="1200" height="630" fill="url(#grid)"/><ellipse cx="720" cy="320" rx="510" ry="360" fill="url(#halo)"/><circle cx="713" cy="316" r="236" fill="none" stroke="${accent}" stroke-opacity=".14"/><circle cx="713" cy="316" r="190" fill="none" stroke="${accent}" stroke-opacity=".08"/><g fill="${accent}" opacity=".6">${[34, 75, 50, 120, 180, 90, 45, 132].map((height, j) => `<rect x="${70 + j * 17}" y="${318 - height / 2}" width="6" height="${height}" rx="3"/>`).join("")}</g><path d="M68 78h26m-13-13v26" stroke="${accent}" stroke-width="5" stroke-linecap="round"/><text x="112" y="87" font-family="sans-serif" font-weight="700" font-size="25" fill="#f3f0fa">MEGARADIO</text><path d="M69 542h132" stroke="${accent}" stroke-width="3"/><text x="1076" y="557" font-family="sans-serif" font-size="22" fill="#aaa6b4">${String(i + 1).padStart(2, "0")}</text><g transform="translate(715 326)" fill="none" stroke="#dedce9" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${drawing.replaceAll("var(--accent)", accent)}</g></svg>`;
  await writeFile(`${output}/${id}.svg`, art);
  for (const width of [640, 1200])
    await sharp(Buffer.from(art))
      .resize(width)
      .webp({ quality: 82 })
      .toFile(`${output}/${id}-${width}.webp`);
}
console.log(
  `Generated ${compositions.length} original illustrations, each with 640px and 1200px WebP variants.`,
);
