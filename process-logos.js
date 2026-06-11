/* Transforme les logos clients en silhouettes transparentes (noir sur transparent)
   pour un recolorage CSS gris -> orange. Sources HD => pas de pixellisation.
   Usage : node process-logos.js  */
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const SRC = 'C:/Users/luluz/Downloads';
const OUT = path.join(__dirname, 'assets', 'clients');
fs.mkdirSync(OUT, { recursive: true });

const FILES = {
  sbm:        'SBM_Monte_Carlo_logo.svg.png',
  advance:    'Gemini_Generated_Image_z8wjgcz8wjgcz8wj.png',
  allios:     'Gemini_Generated_Image_5vzyeq5vzyeq5vzy.png',
  coloris:    'Gemini_Generated_Image_dbe7ledbe7ledbe7.png',
  questel:    'Gemini_Generated_Image_ee72ifee72ifee72.png',
  suez:       'Gemini_Generated_Image_53vpc953vpc953vp.png',
  romessence: 'Gemini_Generated_Image_u5yaviu5yaviu5ya.png',
  parfex:     'Gemini_Generated_Image_66eldf66eldf66el.png',
  sophia:     'Gemini_Generated_Image_b1wwilb1wwilb1ww.png'
};

const MAXDIM = 640; // garde des fichiers légers tout en restant net

(async () => {
  for (const [key, file] of Object.entries(FILES)) {
    const img = await Jimp.read(path.join(SRC, file));
    const d = img.bitmap.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      let alpha;
      if (a < 10) alpha = 0;
      else {
        const w = Math.max(0, Math.min(1, (L - 205) / 40)); // près du blanc -> transparent
        alpha = Math.round(a * (1 - w));
      }
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = alpha;
    }
    try { img.autocrop({ tolerance: 0.002, cropOnlyFrames: false }); } catch (e) {}
    if (Math.max(img.bitmap.width, img.bitmap.height) > MAXDIM) {
      if (img.bitmap.width >= img.bitmap.height) img.resize(MAXDIM, Jimp.AUTO);
      else img.resize(Jimp.AUTO, MAXDIM);
    }
    await img.writeAsync(path.join(OUT, key + '.png'));
    console.log('✓', key, '->', img.bitmap.width + 'x' + img.bitmap.height);
  }
  console.log('done');
})();
