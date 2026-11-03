/*
  Conseiller Martingale v3
  Harmonies de couleurs pour le configurateur CHR.

  Ce qui change par rapport à la v2
    1. Les harmonies ne sont plus des listes « dominante + blanc ». Elles sont construites
       à partir de RECETTES, des types de relation entre deux couleurs :
         camaieu      deux nuances d'une même teinte, à deux clartés différentes
         pastel       clair sur clair, deux teintes différentes
         profond      sombre sur sombre
         contraste    sombre + clair coloré (pas un blanc)
         classique    une couleur + un blanc (blanc, crème, écru, ivoire)
         neutre-vif   un neutre sourd (gris, camel, kaki, olive...) + une couleur vive
         complement   deux teintes opposées, dont une adoucie
         voisines     deux teintes proches, toutes deux colorées
    2. Les AMBIANCES deviennent des filtres : elles disent quelles couleurs et quelles
       recettes leur ressemblent, et donnent les textes. Toutes les couleurs citées
       existent dans la palette du configurateur (41 couleurs).
    3. La 3e couleur (accent) et le contour sont choisis selon des styles nommés.
    4. La sélection impose la variété : dominante, recette, ambiance, et au plus une
       harmonie « classique » par lot de 4.

  Espace colorimétrique : OKLab (L clarté 0..1, C saturation, H teinte en degrés).
  Navigateur : window.ConseillerMartingale ; Node : require('./conseiller-martingale-v3.js')
  API : charger, configurer, couleur, recommander, diagnostiquer, contoursPour,
        THEMES, ORDRE_THEMES, RECETTES, TRESSAGES
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConseillerMartingale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= Tressages ================= */

  // slots      : cases du tressage dans l'ordre des rôles (dominante, équilibre, accent)
  // echo       : cases qui reprennent la couleur d'un autre rôle (grille de la Maille, bords du Damier)
  // couverture : part de surface de chaque rôle
  // lisible    : distance OKLab minimale entre dominante et équilibre pour que le motif se lise
  const TRESSAGES = {
    maille:  { label: 'Maille',  slots: ['c1', 'c3', 'c2'], echo: { c5: 'c1' }, couverture: [0.47, 0.29, 0.24], lisible: 0.12 },
    damier:  { label: 'Damier',  slots: ['c1', 'c3', 'c2'], echo: { c5: 'c1' }, couverture: [0.50, 0.30, 0.20], lisible: 0.14 },
    natte:   { label: 'Natté',   slots: ['c1', 'c2', 'c3'], couverture: [0.50, 0.35, 0.15], lisible: 0.11 },
    serge:   { label: 'Sergé',   slots: ['c1', 'c2'], couverture: [0.50, 0.50], lisible: 0.09 },
    chevron: { label: 'Chevron', slots: ['c1', 'c2'], couverture: [0.50, 0.50], lisible: 0.09 },
    bourdon: { label: 'Bourdon', slots: ['c1', 'c2'], couverture: [0.65, 0.35], lisible: 0.09 }
  };
  const CONFIG = { contourSlot: 'c4', bois: '#7A5230' };

  /* ================= Couleur ================= */

  function srgbToLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function analyser(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = srgbToLin((n >> 16) & 255), g = srgbToLin((n >> 8) & 255), b = srgbToLin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lab = [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    return { lab, L: lab[0], C: Math.hypot(lab[1], lab[2]), H: (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360 };
  }
  const dE = (a, b) => Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]);
  const dL = (a, b) => Math.abs(a.L - b.L);
  const dH = (a, b) => { const d = Math.abs(a.H - b.H) % 360; return d > 180 ? 360 - d : d; };
  // Écart de teinte « utile » : deux couleurs presque grises n'ont pas de teinte qui compte
  const dHu = (a, b) => (a.C < 0.03 || b.C < 0.03) ? 0 : dH(a, b);

  /* ================= Palette ================= */

  let PALETTE = [], PAR_ID = {}, BOIS = analyser(CONFIG.bois);

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function qualifier(c) {
    c.neutre = c.C < 0.045;
    c.vif = c.C >= 0.13;
    c.franc = c.C >= 0.10;
    c.clair = c.L >= 0.76;
    c.sombre = c.L <= 0.55;
    c.blancCasse = c.L >= 0.84 && (c.C < 0.02 || (c.C < 0.07 && c.H >= 60 && c.H <= 130)); // blanc, crème, écru, ivoire (pas le ciel)
    c.noirProche = c.L <= 0.26 && c.C < 0.03;                  // noir
    c.sourd = !c.blancCasse && !c.noirProche && c.L > 0.3 && c.L < 0.78 && (c.C < 0.02 || (c.C < 0.095 && c.H >= 60 && c.H <= 130)); // gris, argent, camel, bronze, kaki, olive, chocolat, brun
    return c;
  }
  function charger(palette) {
    const liste = Array.isArray(palette) ? palette : palette.couleurs;
    if (palette && palette.bois && palette.bois.hex) BOIS = analyser(palette.bois.hex);
    PALETTE = []; PAR_ID = {};
    liste.forEach(e => {
      if (!e || !e.hex || e.actif === false) return;
      const c = qualifier(Object.assign({}, e, analyser(e.hex)));
      c.nomCourt = (e.nomConseiller || e.nom || e.id).trim();
      PALETTE.push(c); PAR_ID[c.id] = c;
    });
    return PALETTE.length;
  }
  function couleur(id) {
    if (!id) return null;
    if (typeof id === 'object') return PAR_ID[id.id] || null;
    return PAR_ID[id] || PALETTE.find(c => norm(c.nom) === norm(id) || norm(c.id) === norm(id)) || null;
  }
  function configurer(o) {
    o = o || {};
    if (o.tressages) Object.keys(o.tressages).forEach(k => { TRESSAGES[k] = Object.assign({}, TRESSAGES[k] || {}, o.tressages[k]); });
    if (o.contourSlot) CONFIG.contourSlot = o.contourSlot;
    if (o.bois) { CONFIG.bois = o.bois; BOIS = analyser(o.bois); }
    if (o.themes) Object.keys(o.themes).forEach(k => { THEMES[k] = Object.assign({}, THEMES[k] || {}, o.themes[k]); });
  }
  const ids = l => (l || []).map(couleur).filter(Boolean);

  /* ================= Textes ================= */

  const bas = c => c.nomCourt.toLowerCase();
  const voyelle = s => /^[aeiouyàâéèêëîïôûü]/i.test(s);
  const du = c => (voyelle(bas(c)) ? "de l'" : 'du ') + bas(c);
  const de = c => (voyelle(bas(c)) ? "d'" : 'de ') + bas(c);
  const le = c => (voyelle(bas(c)) ? "l'" : 'le ') + bas(c);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const Le = c => cap(le(c));
  function hash(s) { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
  const pick = (liste, cle) => liste[hash(cle) % liste.length];

  /* ================= Recettes ================= */

  // Chaque recette renvoie une note d'adéquation 0..1 (null si la paire n'en relève pas).
  // d = dominante, e = équilibre. Les recettes se recouvrent : on garde la mieux notée.
  const RECETTES = {
    camaieu: {
      label: 'Camaïeu', court: 'ton sur ton',
      fit(d, e) {
        if (d.blancCasse || e.blancCasse || d.noirProche || e.noirProche) return null;
        if (d.C < 0.03 || e.C < 0.03) return null;
        const tol = (Math.min(d.C, e.C) < 0.06) ? 52 : 40;
        const h = dH(d, e), l = dL(d, e);
        if (h > tol || l < 0.08 || l > 0.52) return null;
        let f = 1 - (h / tol) * 0.35;
        if (l < 0.16) f -= (0.16 - l) * 2.5;            // trop proche, le motif s'efface
        if (l > 0.44) f -= (l - 0.44) * 1.5;
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, deux nuances d'une même famille. Un camaïeu tout en douceur.`,
        (d, e) => `Un camaïeu ${de(d)} : ${le(e)} vient l'éclairer sans rompre l'harmonie.`,
        (d, e) => `${Le(d)} et ${le(e)} se répondent ton sur ton. Élégant, apaisé.`
      ]
    },
    pastel: {
      label: 'Pastel', court: 'clair sur clair',
      fit(d, e) {
        if (!d.clair || !e.clair || d.blancCasse || e.blancCasse) return null;
        if (d.C < 0.03 || e.C < 0.03) return null;
        const h = dH(d, e), l = dL(d, e);
        if (h < 40 || l > 0.14) return null;
        let f = 0.9 - l;
        if (d.vif && e.vif) f -= 0.3;                     // deux pastels criards, ça vibre
        if (h > 150) f += 0.05;
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, deux pastels côte à côte. Léger, frais, très printanier.`,
        (d, e) => `Clair sur clair : ${bas(d)} et ${bas(e)} dessinent le motif tout en finesse.`,
        (d, e) => `${Le(d)} avec ${le(e)}, un accord poudré qui adoucit la terrasse.`
      ]
    },
    profond: {
      label: 'Profond', court: 'sombre sur sombre',
      fit(d, e) {
        if (!d.sombre || !e.sombre) return null;
        if (d.noirProche && e.noirProche) return null;
        const h = dHu(d, e);
        if (h < 35 && !d.neutre && !e.neutre) return null;   // même teinte : c'est un camaïeu raté
        let f = 0.85;
        if (d.noirProche || e.noirProche) f -= 0.1;
        if (d.franc && e.franc && dL(d, e) < 0.1) f -= 0.2;
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, deux teintes profondes. Le motif se devine, chic et feutré.`,
        (d, e) => `Sombre sur sombre : ${bas(d)} et ${bas(e)}. Une assise qui a du caractère.`,
        (d, e) => `${Le(d)} contre ${le(e)}, une harmonie de nuit. Parfaite en salle, sous les lampes.`
      ]
    },
    contraste: {
      label: 'Contraste', court: 'sombre et clair',
      fit(d, e) {
        const [s, c] = d.L < e.L ? [d, e] : [e, d];
        if (c.blancCasse || c.L < 0.72 || c.C < 0.03) return null;
        if (s.L > 0.68) return null;
        const l = dL(d, e);
        if (s.L > 0.55 && l < 0.2) return null;
        let f = 0.6 + Math.min(0.3, (l - 0.2));
        if (s.noirProche) f -= 0.05;
        if (dHu(s, c) < 35 && !s.neutre) f -= 0.25;        // même teinte : relève du camaïeu
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)} : un contraste franc, le motif se lit de loin.`,
        (d, e) => `${Le(d)} donne le fond, ${le(e)} fait jaillir le dessin. Net et vivant.`,
        (d, e) => `Fort et lisible : ${bas(d)} avec ${bas(e)}. Un duo qui attire l'œil.`
      ]
    },
    classique: {
      label: 'Classique', court: 'couleur et blanc',
      fit(d, e) {
        const nb = (d.blancCasse ? 1 : 0) + (e.blancCasse ? 1 : 0);
        if (nb !== 1) return null;
        const col = d.blancCasse ? e : d;
        const l = dL(d, e);
        if (l < 0.12) return null;
        let f = 0.55 + Math.min(0.3, l * 0.5);
        if (col.sourd) f -= 0.1;
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, le grand classique du tressage. Ça ne se démode pas.`,
        (d, e) => `${Le(d)} sur ${le(e)} : la lisibilité des grandes terrasses.`,
        (d, e) => `Un duo sûr, ${bas(d)} et ${bas(e)}. Propre, clair, élégant.`
      ]
    },
    'neutre-vif': {
      label: 'Neutre et touche vive', court: 'sobre et vif',
      fit(d, e) {
        const [n, v] = d.sourd ? [d, e] : e.sourd ? [e, d] : [null, null];
        if (!n || !v || !v.franc || v.sourd) return null;
        if (dL(n, v) < 0.08 && dHu(n, v) < 40) return null;
        let f = 0.75;
        if (v.vif) f += 0.1;
        if (dL(n, v) < 0.12) f -= 0.1;
        return f;
      },
      phrases: [
        (d, e) => { const [n, v] = d.sourd ? [d, e] : [e, d]; return `Une base ${bas(n)} très sobre, réveillée par ${le(v)}.`; },
        (d, e) => { const [n, v] = d.sourd ? [d, e] : [e, d]; return `${Le(n)} calme le jeu, ${le(v)} apporte la touche de couleur.`; },
        (d, e) => { const [n, v] = d.sourd ? [d, e] : [e, d]; return `Sobriété et peps : ${bas(n)} et ${bas(v)}.`; }
      ]
    },
    complement: {
      label: 'Complémentaires', court: 'teintes opposées',
      fit(d, e) {
        if (d.C < 0.05 || e.C < 0.05 || d.blancCasse || e.blancCasse) return null;
        const h = dH(d, e);
        if (h < 135 || h > 205) return null;
        let f = 0.8 - Math.abs(h - 170) / 100;
        const doux = Math.min(d.C, e.C) < 0.1 || dL(d, e) >= 0.2;
        if (!doux) f -= 0.35;                             // deux teintes vives opposées, ça vibre
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, deux teintes opposées qui se font valoir.`,
        (d, e) => `Face à face : ${bas(d)} et ${bas(e)}. Une tension de couleur maîtrisée.`,
        (d, e) => `${Le(d)} fait chanter ${le(e)}. Vivant, mais sans vibrer.`
      ]
    },
    voisines: {
      label: 'Teintes voisines', court: 'accord fondu',
      fit(d, e) {
        if (d.C < 0.06 || e.C < 0.06 || d.blancCasse || e.blancCasse) return null;
        const h = dH(d, e);
        if (h < 20 || h > 80) return null;
        let f = 0.75 - Math.abs(h - 45) / 120;
        if (dL(d, e) > 0.45) f -= 0.15;
        return f;
      },
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, deux teintes voisines qui glissent l'une vers l'autre.`,
        (d, e) => `Un accord fondu : ${bas(d)} et ${bas(e)}, chaleureux et cohérent.`,
        (d, e) => `${Le(d)} tire vers ${le(e)}. Un dégradé de teintes tout en douceur.`
      ]
    }
  };
  const ORDRE_RECETTES = ['camaieu', 'pastel', 'profond', 'contraste', 'classique', 'neutre-vif', 'complement', 'voisines'];

  /* ================= Ambiances ================= */

  // palette    : couleurs de l'ambiance (dominante ou équilibre)
  // accents    : couleurs réservées à l'accent et au contour (en plus de la palette)
  // recettes   : recettes admises, avec leur poids (1 = neutre, > 1 favorisée)
  // vifs       : nombre maximal de couleurs vives dans le tressage
  // contour    : contours préférés
  // signatures : coups de cœur [dominante, équilibre, accent, contour] ; l'accent est ignoré en duo
  const THEMES = {
    brasserie: {
      label: 'Brasserie parisienne', vifs: 1,
      palette: ['noir', 'bordeaux', 'rouge', 'sapin', 'bleu-marine', 'marron', 'chocolat', 'olive', 'gris', 'argent', 'blanc', 'ivoire', 'creme', 'ecru', 'naturel', 'saumon', 'ciel'],
      accents: ['or', 'bronze'],
      recettes: { classique: 1.2, contraste: 1, camaieu: 1, profond: 1.1, 'neutre-vif': 0.8 },
      contour: ['noir', 'blanc', 'creme', 'ecru', 'bordeaux', 'sapin', 'bleu-marine'],
      signatures: [['noir', 'creme', 'or', 'noir'], ['bordeaux', 'creme', 'noir', 'creme'], ['sapin', 'ivoire', 'bordeaux', 'ivoire'],
        ['bleu-marine', 'ecru', 'rouge', 'ecru'], ['bordeaux', 'saumon', 'noir', 'bordeaux'], ['bleu-marine', 'ciel', 'noir', 'bleu-marine'],
        ['marron', 'creme', 'sapin', 'marron'], ['noir', 'gris', 'rouge', 'noir']],
      noms: ['Grand café', 'Boulevard', 'Zinc', 'Comptoir', 'Rive gauche', 'Terrasse du matin', 'Café de la gare'],
      phrases: ['Un air de grande brasserie parisienne.', 'Comme sur les terrasses des boulevards.', 'Paris, tout simplement.', 'Indémodable, net, élégant.']
    },
    riviera: {
      label: 'Riviera', vifs: 2,
      palette: ['ciel', 'bleu', 'turquoise', 'jaune-pastel', 'jaune', 'rose', 'peche', 'saumon', 'terracotta', 'vert-344', 'lavende', 'blanc', 'ivoire', 'creme', 'bleu-marine', 'rouge-eau', 'orange', 'vert-eau'],
      accents: ['bleu-roi', 'framboise'],
      recettes: { pastel: 1.3, classique: 1, contraste: 1, voisines: 1.1, complement: 1, camaieu: 0.9 },
      contour: ['blanc', 'ivoire', 'bleu-marine', 'bleu-roi', 'turquoise', 'rouge-eau'],
      signatures: [['ciel', 'blanc', 'bleu-marine', 'blanc'], ['turquoise', 'ivoire', 'orange', 'ivoire'], ['jaune-pastel', 'ciel', 'bleu-marine', 'blanc'],
        ['peche', 'turquoise', 'bleu-marine', 'ivoire'], ['rose', 'creme', 'rouge-eau', 'creme'], ['bleu', 'blanc', 'jaune', 'blanc'],
        ['lavende', 'vert-344', 'framboise', 'blanc'], ['saumon', 'vert-eau', 'bleu-marine', 'ivoire'], ['rouge-eau', 'ciel', 'bleu-marine', 'rouge-eau']],
      noms: ['Riviera', 'Promenade', 'Dolce vita', 'Cabine de plage', 'Port de pêche', 'Glacier', 'Pointe du cap'],
      phrases: ['Un parfum de Méditerranée, frais du matin au soir.', 'Comme une glace en terrasse, un jour de grand soleil.', 'On entend presque les vagues.', 'Léger, lumineux, joyeux.']
    },
    cotebasque: {
      label: 'Côte basque', vifs: 1,
      palette: ['rouge', 'bordeaux', 'sapin', 'kaki', 'bleu-marine', 'vert-eau', 'vert-2260', 'blanc', 'ecru', 'creme', 'ivoire', 'noir', 'naturel', 'saumon'],
      accents: [],
      recettes: { classique: 1.2, contraste: 1, profond: 1, camaieu: 0.9 },
      contour: ['blanc', 'rouge', 'sapin', 'ecru', 'bleu-marine'],
      signatures: [['rouge', 'blanc', 'sapin', 'blanc'], ['sapin', 'ecru', 'rouge', 'ecru'], ['bordeaux', 'ecru', 'sapin', 'ecru'],
        ['bleu-marine', 'blanc', 'rouge', 'blanc'], ['sapin', 'vert-2260', 'rouge', 'sapin'], ['rouge', 'sapin', 'ecru', 'ecru'], ['vert-eau', 'ecru', 'rouge', 'vert-eau']],
      noms: ['Pays basque', 'Fronton', 'Txoko', 'Linge basque', 'Piment', 'Grande plage', 'Port vieux'],
      phrases: ['Les couleurs du linge basque, franches et chaleureuses.', 'Un air de fête de village, entre océan et montagne.', 'Simple et vivant, comme un fronton un dimanche.', 'Le caractère de la côte, la lumière de l\'océan.']
    },
    barvin: {
      label: 'Bar à vin', vifs: 1,
      palette: ['bordeaux', 'prune', 'fushia', 'marron', 'chocolat', 'brun', 'olive', 'sapin', 'noir', 'bleu-marine', 'ecru', 'creme', 'naturel', 'kaki', 'gris', 'ivoire', 'saumon', 'peche', 'terracotta'],
      accents: ['or', 'bronze', 'rouge-eau', 'framboise'],
      recettes: { profond: 1.3, camaieu: 1.2, classique: 0.8, contraste: 1, 'neutre-vif': 0.9 },
      contour: ['noir', 'marron', 'chocolat', 'bordeaux', 'creme', 'ecru', 'olive'],
      signatures: [['bordeaux', 'creme', 'or', 'bordeaux'], ['prune', 'ecru', 'noir', 'noir'], ['marron', 'saumon', 'bordeaux', 'marron'],
        ['olive', 'creme', 'bordeaux', 'olive'], ['noir', 'naturel', 'bordeaux', 'noir'], ['bordeaux', 'olive', 'ecru', 'bordeaux'],
        ['fushia', 'marron', 'ecru', 'marron'], ['prune', 'bleu-marine', 'creme', 'noir'], ['chocolat', 'peche', 'bordeaux', 'chocolat']],
      noms: ['Bar à vin', 'Cave', 'Fin de soirée', 'Velours', 'Tannin', 'Comptoir à vin', 'Arrière-salle'],
      phrases: ['Une ambiance feutrée de fin de soirée.', 'Chic et enveloppant, comme un bon verre.', 'Parfait pour une cave ou une salle tamisée.', 'Tout en rondeur, on s\'y attarde volontiers.']
    },
    hotelchic: {
      label: 'Hôtel chic', vifs: 0,
      palette: ['creme', 'ecru', 'ivoire', 'blanc', 'gris', 'argent', 'vert-2260', 'vert-diamant', 'sapin', 'olive', 'kaki', 'naturel', 'bronze', 'noir', 'marron', 'chocolat', 'bleu-marine', 'ciel', 'lavende', 'saumon'],
      accents: ['or'],
      recettes: { classique: 1, camaieu: 1.3, contraste: 1, profond: 1.1, pastel: 1 },
      contour: ['noir', 'creme', 'ecru', 'olive', 'marron', 'sapin', 'gris'],
      signatures: [['creme', 'noir', 'or', 'noir'], ['vert-2260', 'olive', 'or', 'olive'], ['ecru', 'bleu-marine', 'or', 'ecru'],
        ['gris', 'noir', 'argent', 'noir'], ['ivoire', 'chocolat', 'bronze', 'chocolat'], ['argent', 'ecru', 'noir', 'gris'],
        ['sapin', 'vert-diamant', 'creme', 'sapin'], ['olive', 'ivoire', 'bronze', 'olive'], ['bleu-marine', 'gris', 'or', 'bleu-marine'], ['naturel', 'ecru', 'marron', 'marron']],
      noms: ['Lobby', 'Palace', 'Salon', 'Suite', 'Patio', 'Hôtel particulier', 'Jardin d\'hiver'],
      phrases: ['Le luxe discret, tout en retenue.', 'Une élégance calme, digne d\'un beau lobby.', 'Chic sans jamais en faire trop.', 'Très hôtel particulier.']
    },
    plage: {
      label: 'Bord de mer', vifs: 1,
      palette: ['naturel', 'creme', 'ecru', 'ivoire', 'blanc', 'ciel', 'turquoise', 'bleu', 'vert-eau', 'bleu-marine', 'sapin', 'saumon', 'terracotta', 'kaki', 'gris', 'argent'],
      accents: ['orange', 'rouge-eau', 'jaune', 'or', 'rouge'],
      recettes: { classique: 1.1, pastel: 1, camaieu: 1.1, contraste: 1, complement: 1, 'neutre-vif': 1 },
      contour: ['blanc', 'naturel', 'ecru', 'bleu-marine', 'turquoise', 'sapin'],
      signatures: [['naturel', 'blanc', 'bleu-marine', 'blanc'], ['ecru', 'bleu-marine', 'rouge-eau', 'ecru'], ['creme', 'naturel', 'turquoise', 'naturel'],
        ['ciel', 'blanc', 'rouge', 'blanc'], ['turquoise', 'ecru', 'bleu-marine', 'turquoise'], ['vert-eau', 'naturel', 'ecru', 'sapin'],
        ['bleu-marine', 'ciel', 'naturel', 'bleu-marine'], ['saumon', 'ciel', 'bleu-marine', 'blanc'], ['ecru', 'ciel', 'terracotta', 'ecru'], ['bleu', 'ecru', 'or', 'bleu-marine']],
      noms: ['Paillote', 'Bord de mer', 'Sieste au soleil', 'Marée haute', 'Cabanon', 'Grande bleue', 'Ponton'],
      phrases: ['Un air de vacances, les pieds dans l\'eau.', 'Comme le sable et l\'écume.', 'L\'esprit paillote, simple et lumineux.', 'Pour une terrasse face à la mer.']
    },
    guinguette: {
      label: 'Guinguette', vifs: 1,
      palette: ['vert-2260', 'vert-diamant', 'vert-344', 'vert-pomme', 'vert-citron', 'kaki', 'sapin', 'olive', 'vert-eau', 'jaune-pastel', 'blanc', 'creme', 'ecru', 'ivoire', 'rose', 'saumon', 'peche', 'lavende'],
      accents: ['framboise', 'rouge-eau', 'orange', 'jaune', 'rouge'],
      recettes: { classique: 1, camaieu: 1.2, contraste: 1, complement: 1.1, pastel: 1, voisines: 1 },
      contour: ['blanc', 'creme', 'sapin', 'kaki', 'olive', 'framboise'],
      signatures: [['vert-2260', 'blanc', 'framboise', 'blanc'], ['sapin', 'creme', 'rose', 'creme'], ['kaki', 'ivoire', 'orange', 'kaki'],
        ['vert-diamant', 'blanc', 'lavende', 'blanc'], ['vert-pomme', 'rose', 'sapin', 'blanc'], ['kaki', 'saumon', 'sapin', 'kaki'],
        ['vert-344', 'framboise', 'blanc', 'blanc'], ['olive', 'jaune-pastel', 'rose', 'olive'], ['vert-eau', 'peche', 'sapin', 'creme'], ['sapin', 'vert-citron', 'rouge-eau', 'sapin']],
      noms: ['Guinguette', 'Bord de Marne', 'Jardin d\'été', 'Tonnelle', 'Pique-nique', 'Dimanche au vert', 'Buvette'],
      phrases: ['Comme une tonnelle un dimanche d\'été.', 'De la fraîcheur, on a envie de rester dehors.', 'L\'esprit guinguette, gai et sans façon.', 'Un jardin en terrasse.']
    },
    pop: {
      label: 'Pop graphique', vifs: 3, ose: true,
      palette: ['jaune', 'orange', 'framboise', 'fushia', 'bleu-roi', 'bleu', 'turquoise', 'vert-citron', 'vert-pomme', 'rose', 'rouge', 'rouge-eau', 'prune', 'lavende', 'jaune-pastel', 'blanc', 'noir', 'creme', 'bleu-marine'],
      accents: [],
      recettes: { contraste: 1.2, complement: 1.2, voisines: 1.1, classique: 0.7, profond: 1, pastel: 0.9, 'neutre-vif': 0.8 },
      contour: ['noir', 'blanc', 'bleu-roi', 'jaune', 'framboise'],
      signatures: [['jaune', 'blanc', 'bleu-roi', 'noir'], ['framboise', 'blanc', 'orange', 'blanc'], ['bleu-roi', 'blanc', 'jaune', 'bleu-roi'],
        ['vert-citron', 'noir', 'rose', 'noir'], ['orange', 'bleu-roi', 'blanc', 'noir'], ['framboise', 'orange', 'blanc', 'noir'],
        ['bleu-roi', 'jaune', 'blanc', 'bleu-roi'], ['rouge', 'rose', 'noir', 'noir'], ['turquoise', 'orange', 'noir', 'blanc'], ['fushia', 'jaune-pastel', 'noir', 'noir'], ['bleu-roi', 'rose', 'blanc', 'bleu-roi']],
      noms: ['Pop', 'Néon', 'Coup d\'éclat', 'Rooftop', 'Club', 'Graphique', 'Pleine couleur'],
      phrases: ['Le motif claque, même de loin.', 'Impossible de passer à côté.', 'Fait pour être photographié.', 'Énergie maximale, l\'esprit rooftop.']
    },
    terre: {
      label: 'Terre cuite', vifs: 1,
      palette: ['terracotta', 'rouge-eau', 'orange', 'peche', 'saumon', 'naturel', 'bronze', 'brun', 'chocolat', 'marron', 'bordeaux', 'olive', 'kaki', 'sapin', 'vert-eau', 'ecru', 'creme', 'ivoire', 'blanc', 'noir', 'gris'],
      accents: ['or', 'turquoise'],
      recettes: { camaieu: 1.3, contraste: 1, classique: 0.9, complement: 1.1, voisines: 1.1, profond: 1, 'neutre-vif': 1 },
      contour: ['marron', 'chocolat', 'ecru', 'creme', 'noir', 'olive', 'terracotta'],
      signatures: [['terracotta', 'ecru', 'olive', 'marron'], ['marron', 'peche', 'olive', 'marron'], ['rouge-eau', 'creme', 'sapin', 'chocolat'],
        ['olive', 'terracotta', 'ecru', 'olive'], ['chocolat', 'saumon', 'ecru', 'chocolat'], ['terracotta', 'vert-eau', 'ecru', 'marron'],
        ['naturel', 'bordeaux', 'ecru', 'marron'], ['kaki', 'terracotta', 'creme', 'olive'], ['bronze', 'ecru', 'rouge-eau', 'chocolat'], ['orange', 'chocolat', 'ecru', 'chocolat']],
      noms: ['Terre cuite', 'Patio', 'Tomette', 'Cuisine du sud', 'Sous l\'olivier', 'Sieste à l\'ombre', 'Mas'],
      phrases: ['Des tons de terre et de soleil, chauds et rassurants.', 'Comme un patio à l\'heure de la sieste.', 'La chaleur d\'une cuisine du sud.', 'Simple, terrien, lumineux.']
    },
    poudre: {
      label: 'Poudré', vifs: 1,
      palette: ['saumon', 'peche', 'rose', 'lavende', 'ciel', 'vert-344', 'vert-2260', 'vert-diamant', 'jaune-pastel', 'ivoire', 'creme', 'blanc', 'ecru', 'argent', 'gris', 'turquoise', 'vert-citron', 'terracotta'],
      accents: ['prune', 'framboise', 'bleu-marine', 'vert-eau'],
      recettes: { pastel: 1.4, camaieu: 1.1, classique: 0.9, voisines: 1.1, contraste: 0.8, complement: 0.9 },
      contour: ['blanc', 'ivoire', 'creme', 'argent', 'gris', 'lavende', 'rose'],
      signatures: [['saumon', 'vert-344', 'creme', 'blanc'], ['lavende', 'jaune-pastel', 'prune', 'blanc'], ['rose', 'ciel', 'ivoire', 'blanc'],
        ['peche', 'lavende', 'creme', 'ivoire'], ['vert-2260', 'saumon', 'ivoire', 'argent'], ['ciel', 'peche', 'bleu-marine', 'blanc'],
        ['vert-diamant', 'rose', 'creme', 'vert-diamant'], ['jaune-pastel', 'turquoise', 'ivoire', 'blanc'], ['rose', 'vert-citron', 'blanc', 'rose'], ['lavende', 'vert-344', 'ivoire', 'lavende']],
      noms: ['Poudré', 'Salon de thé', 'Pâtisserie', 'Boudoir', 'Macaron', 'Jardin de roses', 'Dragée'],
      phrases: ['Doux comme une boîte de macarons.', 'L\'esprit salon de thé, tendre et lumineux.', 'Des teintes poudrées qui adoucissent tout.', 'Frais, léger, un peu rétro.']
    }
  };
  const ORDRE_THEMES = ['brasserie', 'riviera', 'cotebasque', 'barvin', 'hotelchic', 'plage', 'guinguette', 'pop', 'terre', 'poudre'];

  /* ================= Accents (3e couleur) ================= */

  const ACCENT_STYLES = {
    echo:   { label: 'Écho',   phrases: [a => `${Le(a)} prolonge la famille de couleurs.`, a => `Une troisième nuance, ${bas(a)}, dans le même esprit.`] },
    neutre: { label: 'Neutre', phrases: [a => `${Le(a)} vient poser le motif.`, a => `Un trait ${de(a)} qui structure l'ensemble.`] },
    touche: { label: 'Touche', phrases: [a => `Une pointe ${de(a)} fait vibrer le motif.`, a => `Et une note ${de(a)} qui attire l'œil.`, a => `${Le(a)} vient réveiller le tressage.`] },
    pont:   { label: 'Pont',   phrases: [a => `${Le(a)} fait le lien entre les deux.`, a => `${Le(a)}, à mi-chemin, relie le tout.`] }
  };

  // Classe un accent par rapport à la paire (d, e). Renvoie null s'il ne convient pas.
  function styleAccent(a, d, e, theme) {
    const ed = dE(a, d), ee = dE(a, e);
    if (Math.min(ed, ee) < 0.1) return null;                    // invisible
    const hd = dHu(a, d), he = dHu(a, e);
    if (a.blancCasse || a.noirProche || a.neutre) return { style: 'neutre', fit: 0.8 + Math.min(0.15, Math.min(ed, ee) * 0.4) };
    if (hd <= 35 || he <= 35) return { style: 'echo', fit: 0.85 };
    const hde = dH(d, e);
    if (hde > 60 && hd < hde && he < hde && Math.abs(hd - he) < 40 && !a.vif) return { style: 'pont', fit: 0.8 };
    if (a.franc && hd >= 45 && he >= 45) {
      const vifsBase = (d.vif ? 1 : 0) + (e.vif ? 1 : 0);
      if (vifsBase >= 2 && !theme.ose) return null;
      return { style: 'touche', fit: 0.85 + Math.min(0.15, Math.min(ed, ee) * 0.3) };
    }
    if (hd >= 45 && he >= 45 && !a.franc) return { style: 'touche', fit: 0.6 };
    return null;
  }

  /* ================= Notation ================= */

  // Note une paire dans une ambiance. Renvoie null si l'harmonie ne tient pas.
  function noterPaire(d, e, theme, t) {
    if (dE(d, e) < t.lisible) return null;                      // le motif disparaîtrait
    let best = null;
    Object.keys(RECETTES).forEach(id => {
      const w = theme.recettes[id];
      if (!w) return;
      const f = RECETTES[id].fit(d, e);
      if (f === null || f === undefined) return;
      const v = f * w;
      if (!best || v > best.v) best = { recette: id, fit: f, v };
    });
    if (!best) return null;
    let sc = 58 + best.v * 24;
    // deux couleurs vives de même clarté et de teintes éloignées : ça vibre
    if (d.franc && e.franc && dL(d, e) < 0.1 && dH(d, e) >= 50) sc -= theme.ose ? 8 : 24;
    // teintes qui se battent (ni proches, ni opposées) entre deux couleurs franches de clarté voisine
    else if (d.franc && e.franc && dH(d, e) > 55 && dH(d, e) < 135 && dL(d, e) < 0.2) sc -= theme.ose ? 2 : 9;
    // couleur trop proche de la structure en bois
    if (dE(d, BOIS) < 0.07) sc -= 10;
    if (dE(e, BOIS) < 0.07) sc -= 6;
    return { score: sc, recette: best.recette, fit: best.fit };
  }

  function noterTrio(cols, theme, t, base) {
    const [d, e, a] = cols;
    const st = styleAccent(a, d, e, theme);
    if (!st) return null;
    let sc = base.score + (st.fit - 0.75) * 20;
    const vifs = cols.filter(c => c.vif).length;
    if (vifs > theme.vifs) sc -= (vifs - theme.vifs) * 14;
    if (dE(a, BOIS) < 0.07) sc -= 5;
    // trois couleurs franches de clarté voisine : trop chargé hors Pop
    if (d.franc && e.franc && a.franc && !theme.ose) sc -= 10;
    return { score: sc, recette: base.recette, accentStyle: st.style };
  }

  function noter(cols, theme, t) {
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (dE(cols[i], cols[j]) < 0.07) return null;
    const base = noterPaire(cols[0], cols[1], theme, t);
    if (!base) return null;
    if (cols.length === 2) {
      const vifs = cols.filter(c => c.vif).length;
      if (vifs > theme.vifs) base.score -= (vifs - theme.vifs) * 14;
      return base;
    }
    return noterTrio(cols, theme, t, base);
  }

  /* ================= Contours ================= */

  const CONTOURS = {
    echo:   { label: 'Écho du tressage', phrases: [c => `Contour ${bas(c)}, repris du tressage.`, c => `Le contour reprend ${le(c)} : tout est relié.`] },
    cadre:  { label: 'Cadre sombre',     phrases: [c => `Un contour ${bas(c)} vient cadrer l'assise.`, c => `Contour ${bas(c)}, qui dessine la silhouette.`] },
    clair:  { label: 'Cadre clair',      phrases: [c => `Contour ${bas(c)} pour alléger le bord.`, c => `Un contour ${bas(c)}, sobre, qui met le motif en valeur.`] },
    ton:    { label: 'Ton sur ton',      phrases: [c => `Contour ${bas(c)}, une nuance plus soutenue.`, c => `Le contour ${bas(c)} approfondit la dominante.`] },
    signature: { label: 'Signature',     phrases: [c => `Contour ${bas(c)} en signature.`, c => `Et un contour ${bas(c)} pour signer l'ensemble.`] }
  };

  function contoursPour(cols, theme, n) {
    const d = cols[0];
    const moyL = cols.reduce((s, c) => s + c.L, 0) / cols.length;
    const cands = new Map();
    ids(theme.contour).forEach(c => cands.set(c.id, c));
    cols.forEach(c => cands.set(c.id, c));
    ['blanc', 'creme', 'ecru', 'noir'].forEach(id => { const c = couleur(id); if (c) cands.set(c.id, c); });
    const res = [...cands.values()].map(c => {
      let sc = 50, style;
      const dansTressage = cols.some(x => x.id === c.id);
      if (dansTressage) { style = 'echo'; sc += 18; if (c.id === d.id) sc -= 3; }
      else if (c.sombre && c.C >= 0.03 && d.C >= 0.03 && dH(c, d) <= 45 && c.L < d.L - 0.15) { style = 'ton'; sc += 14; }
      else if (c.sombre) { style = 'cadre'; sc += moyL > 0.6 ? 7 : 1; if (c.noirProche) sc -= 3; }
      else if (c.blancCasse || c.L > 0.8) { style = 'clair'; sc += moyL < 0.62 ? 9 : 3; }
      else style = 'signature';
      if (theme.contour.indexOf(c.id) >= 0) sc += 9;
      if (dE(c, BOIS) < 0.08) sc -= 20;                           // se perd sur le bois
      if (!dansTressage) sc += Math.min(6, dE(c, d) * 12);         // se détache de la dominante
      if (c.vif && !theme.ose && !dansTressage) sc -= 8;
      return { id: c.id, nom: c.nom, hex: c.hex, style, styleLabel: CONTOURS[style].label, score: Math.round(sc) };
    }).sort((x, y) => y.score - x.score);
    return res.slice(0, n || 3);
  }

  /* ================= Génération ================= */

  function cleDe(x) { return x.cols.map(c => c.id).join('+'); }

  function candidatsTheme(themeId, t, filtreRecette) {
    const th = THEMES[themeId];
    const P = ids(th.palette), A = P.concat(ids(th.accents));
    const out = [];
    const ajouter = (cols, sig) => {
      const r = noter(cols, th, t);
      if (!r) return;
      if (filtreRecette && r.recette !== filtreRecette) return;
      out.push({ cols, theme: themeId, recette: r.recette, accentStyle: r.accentStyle || null, score: r.score + (sig !== undefined ? 6 : 0), signature: sig !== undefined, sigContour: sig || null });
    };
    (th.signatures || []).forEach(s => {
      const c = ids(s.slice(0, t.slots.length));
      if (c.length === t.slots.length) ajouter(c, couleur(s[3]) ? s[3] : null);
    });
    if (t.slots.length === 2) {
      for (const d of P) for (const e of P) if (d.id !== e.id) ajouter([d, e]);
    } else {
      for (const d of P) for (const e of P) {
        if (d.id === e.id) continue;
        const base = noterPaire(d, e, th, t);
        if (!base) continue;
        for (const a of A) if (a.id !== d.id && a.id !== e.id) ajouter([d, e, a]);
      }
    }
    const vu = new Map();
    out.forEach(x => { const k = cleDe(x); if (!vu.has(k) || vu.get(k).score < x.score) vu.set(k, x); });
    return [...vu.values()];
  }

  function rngDe(graine) {
    if (graine === undefined || graine === null) return Math.random;
    let h = hash(graine);
    return function () { h |= 0; h = (h + 0x6D2B79F5) | 0; let q = Math.imul(h ^ (h >>> 15), 1 | h); q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q; return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
  }

  // Sélection variée : bonne note, mais jamais deux fois la même idée
  function selectionner(cands, n, rng, alea, exclure, opts) {
    opts = opts || {};
    const ex = new Set(exclure || []);
    const domVu = {}, colVu = {};
    (exclure || []).forEach(k => { const l = String(k).split('+'); domVu[l[0]] = (domVu[l[0]] || 0) + 1; l.forEach(i => { colVu[i] = (colVu[i] || 0) + 1; }); });
    const reste = cands.filter(c => !ex.has(cleDe(c)));
    const pris = [];
    while (pris.length < n && reste.length) {
      let best = -1e9, bi = 0;
      reste.forEach((c, i) => {
        let v = c.score + (rng() - 0.5) * 2 * alea;
        v -= 8 * (domVu[c.cols[0].id] || 0);
        c.cols.slice(1).forEach(x => { v -= 2 * (colVu[x.id] || 0); });
        for (const p of pris) {
          if (p.cols[0].id === c.cols[0].id) v -= 30;
          const s = new Set(p.cols.map(x => x.id));
          v -= c.cols.filter(x => s.has(x.id)).length * 9;
          if (p.theme === c.theme && !opts.memeTheme) v -= 8;
          if (p.recette === c.recette) v -= (c.recette === 'classique' ? 40 : 12);
        }
        if (v > best) { best = v; bi = i; }
      });
      pris.push(reste.splice(bi, 1)[0]);
    }
    return pris;
  }

  function nomLibre(noms, cle, pris) {
    let i = hash(cle) % noms.length;
    for (let k = 0; k < noms.length && pris && pris.has(noms[i]); k++) i = (i + 1) % noms.length;
    if (pris) pris.add(noms[i]);
    return noms[i];
  }

  function finaliser(x, t, nomsPris) {
    const th = THEMES[x.theme];
    const [d, e, a] = x.cols;
    let alternatives = contoursPour(x.cols, th, 3);
    if (x.sigContour) {
      const c = couleur(x.sigContour);
      const deja = alternatives.find(y => y.id === c.id);
      let sig = deja;
      if (!sig) {
        const tous = contoursPour(x.cols, th, 99);
        sig = tous.find(y => y.id === c.id) || { id: c.id, nom: c.nom, hex: c.hex, style: 'signature', styleLabel: CONTOURS.signature.label, score: 70 };
      }
      alternatives = [sig].concat(alternatives.filter(y => y.id !== c.id)).slice(0, 3);
    }
    const contour = alternatives[0];
    const couleurs = {}, slots = {};
    t.slots.forEach((slot, i) => { couleurs[slot] = x.cols[i].id; slots[slot] = x.cols[i].hex; });
    Object.keys(t.echo || {}).forEach(slot => { couleurs[slot] = couleurs[t.echo[slot]]; slots[slot] = slots[t.echo[slot]]; });
    slots[CONFIG.contourSlot] = contour.hex;
    const cle = cleDe(x);
    const rec = RECETTES[x.recette];
    let pourquoi = pick(rec.phrases, cle)(d, e) + ' ' + pick(th.phrases, cle + 't');
    if (a) pourquoi += ' ' + pick(ACCENT_STYLES[x.accentStyle || 'touche'].phrases, cle + 'a')(a);
    pourquoi += ' ' + pick((CONTOURS[contour.style] || CONTOURS.signature).phrases, cle + 'c')(couleur(contour.id));
    return {
      id: t.id + ':' + cle + ':' + contour.id,
      cle,
      nom: nomLibre(th.noms, cle, nomsPris) + ' · ' + cap(d.nomCourt),
      ambiance: th.label,
      theme: x.theme,
      recette: x.recette,
      recetteLabel: rec.label,
      accentStyle: x.accentStyle || null,
      signature: x.signature,
      tressage: t.id,
      couleurs,
      contour: contour.id,
      slots,
      score: Math.max(0, Math.min(100, Math.round(x.score))),
      pourquoi,
      contoursAlternatifs: alternatives
    };
  }

  /* ================= API publique ================= */

  function tressage(id) {
    const k = norm(id);
    const t = TRESSAGES[k];
    if (!t) throw new Error('Tressage inconnu : ' + id);
    return Object.assign({ id: k }, t);
  }

  /**
   * o.tressage  'maille' | 'damier' | 'natte' | 'serge' | 'chevron' | 'bourdon'
   * o.famille   identifiant d'ambiance (voir THEMES) ou 'aucune' / 'surprise' pour mélanger
   * o.recette   identifiant de recette (voir RECETTES) pour ne garder qu'un type d'harmonie
   * o.n         nombre de propositions (4 par défaut)
   * o.graine    graine du hasard ; o.alea dose de hasard ; o.exclure clés déjà montrées
   */
  function recommander(o) {
    o = o || {};
    if (!PALETTE.length) throw new Error('Palette non chargée : appeler charger(palette) avant.');
    const t = tressage(o.tressage || 'maille');
    const fam = norm(o.famille || 'aucune');
    const themes = THEMES[fam] ? [fam] : ORDRE_THEMES;
    const rec = o.recette && RECETTES[norm(o.recette)] ? norm(o.recette) : null;
    let cands = [];
    themes.forEach(id => { cands = cands.concat(candidatsTheme(id, t, rec)); });
    cands.sort((a, b) => b.score - a.score);
    // Les meilleures, avec au plus 6 idées par dominante et par ambiance pour laisser de la place à toutes
    const parDom = {}, top = [];
    for (const c of cands) {
      const k = c.theme + '|' + c.cols[0].id;
      if ((parDom[k] || 0) >= 6) continue;
      parDom[k] = (parDom[k] || 0) + 1; top.push(c);
      if (top.length >= 600) break;
    }
    const choix = selectionner(top, o.n || 4, rngDe(o.graine), o.alea === undefined ? 10 : o.alea, o.exclure, { memeTheme: themes.length === 1 });
    const nomsPris = new Set();
    return choix.map(x => finaliser(x, t, nomsPris));
  }

  // Avis rapide sur une configuration manuelle (dans l'ambiance qui lui va le mieux)
  function diagnostiquer(o) {
    const t = tressage(o.tressage);
    const cols = t.slots.map(s => couleur(o.couleurs[s]));
    if (cols.some(c => !c)) return { score: null, niveau: 'incomplet', conseils: ['Choisis toutes les couleurs du tressage.'] };
    let best = null;
    ORDRE_THEMES.forEach(id => { const r = noter(cols, THEMES[id], t); if (r && (!best || r.score > best.score)) best = { score: r.score, theme: id, recette: r.recette }; });
    if (!best) {
      const conseils = [];
      if (dE(cols[0], cols[1]) < t.lisible) conseils.push('Les deux premières couleurs sont trop proches : le motif se lit mal.');
      else conseils.push('Cette alliance ne correspond à aucune de nos harmonies. Essaie de changer une couleur.');
      return { score: 40, niveau: 'a-revoir', conseils };
    }
    return { score: Math.round(best.score), niveau: best.score >= 80 ? 'excellent' : best.score >= 65 ? 'bon' : 'a-revoir', ambiance: THEMES[best.theme].label, recette: RECETTES[best.recette].label, conseils: [] };
  }

  return {
    CONFIG, TRESSAGES, THEMES, ORDRE_THEMES, RECETTES, ORDRE_RECETTES, ACCENT_STYLES, CONTOURS,
    charger, configurer, couleur, recommander, diagnostiquer,
    contoursPour: (cols, themeId, n) => contoursPour(ids(cols), THEMES[themeId] || THEMES.brasserie, n),
    candidats: (tressageId, themeId, recette) => { const t = tressage(tressageId); const th = THEMES[themeId] ? [themeId] : ORDRE_THEMES; let c = []; th.forEach(id => { c = c.concat(candidatsTheme(id, t, recette)); }); c.sort((a, b) => b.score - a.score); const vu = new Set(); return c.filter(x => { const k = cleDe(x); if (vu.has(k)) return false; vu.add(k); return true; }).map(x => finaliser(x, t, null)); },
    palette: () => PALETTE.slice(),
    outils: { analyser, dE, dL, dH, noter, styleAccent }
  };
});
