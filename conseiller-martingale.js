/*
  Conseiller Martingale v1
  Moteur d'alliances couleurs pour le configurateur CHR.

  Espace colorimétrique : OKLab / OKLCH
    L = clarté (0 noir, 1 blanc), C = saturation, H = teinte en degrés.

  Navigateur : charger conseiller-martingale.js puis utiliser window.ConseillerMartingale
  Node       : const CM = require('./conseiller-martingale.js')
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConseillerMartingale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= Réglages à ajuster ================= */

  const CONFIG = {
    contourSlot: 'c4',   // case couleur du contour dans le configurateur
    bois: '#7A5230',     // structure bois (écrasé par palette.bois si présent)
    seuil: 55,           // note minimale pour proposer une alliance
    ecartMin: 0.07,      // écart minimal entre deux couleurs du tressage
    poidsContour: 0.2    // part du contour dans la note finale
  };

  // slots : cases remplies par le conseiller, dans l'ordre des rôles (dominante, équilibre, accent)
  // couverture : part de surface approximative de chaque slot
  // contraste : écart de clarté idéal entre dominante et équilibre
  // À caler sur les slots réels du mode manuel.
  const TRESSAGES = {
    maille:  { label: 'Maille',  slots: ['c1', 'c2', 'c3'], couverture: [0.55, 0.30, 0.15], contraste: [0.20, 0.40] },
    damier:  { label: 'Damier',  slots: ['c1', 'c2', 'c3'], couverture: [0.45, 0.45, 0.10], contraste: [0.30, 0.65] },
    serge:   { label: 'Sergé',   slots: ['c1', 'c2'],       couverture: [0.50, 0.50],       contraste: [0.08, 0.25] },
    chevron: { label: 'Chevron', slots: ['c1', 'c2'],       couverture: [0.50, 0.50],       contraste: [0.08, 0.25] },
    natte:   { label: 'Natté',   slots: ['c1', 'c2', 'c3'], couverture: [0.50, 0.35, 0.15], contraste: [0.15, 0.35] },
    bourdon: { label: 'Bourdon', slots: ['c1', 'c2'],       couverture: [0.65, 0.35],       contraste: [0.12, 0.35] }
  };

  const ROLES = ['dominante', 'equilibre', 'accent'];

  /* ================= Couleur ================= */

  function srgbToLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function linToSrgb(v) {
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  function hexToLin(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [srgbToLin((n >> 16) & 255), srgbToLin((n >> 8) & 255), srgbToLin(n & 255)];
  }
  function linToHex(l) { return '#' + l.map(v => linToSrgb(v).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function linToLab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }
  function analyser(hex) {
    const lin = hexToLin(hex);
    const lab = linToLab(lin[0], lin[1], lin[2]);
    const C = Math.hypot(lab[1], lab[2]);
    const H = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
    return { lin, lab, L: lab[0], C, H };
  }
  const dE = (a, b) => Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]);
  const dL = (a, b) => Math.abs(a.L - b.L);
  const dH = (a, b) => { const d = Math.abs(a.H - b.H) % 360; return d > 180 ? 360 - d : d; };

  function melange(cols, poids) {
    const l = [0, 0, 0]; let tot = 0;
    cols.forEach((c, i) => { const w = poids[i] || 0; tot += w; for (let k = 0; k < 3; k++) l[k] += c.lin[k] * w; });
    const lin = l.map(v => v / (tot || 1));
    const a = linToLab(lin[0], lin[1], lin[2]);
    return { lin, lab: a, L: a[0], C: Math.hypot(a[1], a[2]), H: (Math.atan2(a[2], a[1]) * 180 / Math.PI + 360) % 360, hex: linToHex(lin) };
  }

  /* ================= Palette ================= */

  let PALETTE = [];      // couleurs utilisables
  let PAR_ID = {};       // id -> couleur (alias inclus, redirigés)
  let BOIS = analyser(CONFIG.bois);
  let VALIDES = null;    // alliances validées à la main

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function preparer(e) {
    const a = analyser(e.hex);
    const nomCourt = (e.nomConseiller || e.nom).replace(/\s+\d+$/, '').trim();
    const c = Object.assign({}, e, a, { nomCourt, roles: e.roles || ROLES.concat('contour') });
    c.appui = c.C < 0.045 || (c.L >= 0.88 && c.C < 0.085) || (c.L <= 0.40 && c.C < 0.07);
    c.clair = c.L >= 0.85 && c.C < 0.085;
    return c;
  }

  function charger(palette) {
    const liste = Array.isArray(palette) ? palette : palette.couleurs;
    if (palette.bois && palette.bois.hex) BOIS = analyser(palette.bois.hex);
    PALETTE = []; PAR_ID = {};
    liste.forEach(e => { if (!e.alias_de && e.actif !== false && e.hex) { const c = preparer(e); PALETTE.push(c); PAR_ID[c.id] = c; } });
    liste.forEach(e => { if (e.alias_de && PAR_ID[e.alias_de]) PAR_ID[e.id] = PAR_ID[e.alias_de]; });
    return PALETTE.length;
  }

  function couleur(id) {
    if (!id) return null;
    if (typeof id === 'object') return id.lab ? id : PAR_ID[id.id];
    return PAR_ID[id] || PAR_ID[norm(id)] || PALETTE.find(c => norm(c.nom) === norm(id) || c.hex.toLowerCase() === String(id).toLowerCase()) || null;
  }

  function configurer(o) {
    o = o || {};
    if (o.tressages) Object.keys(o.tressages).forEach(k => { TRESSAGES[k] = Object.assign({}, TRESSAGES[k] || {}, o.tressages[k]); });
    ['contourSlot', 'seuil', 'ecartMin', 'poidsContour'].forEach(k => { if (o[k] !== undefined) CONFIG[k] = o[k]; });
    if (o.bois) { CONFIG.bois = o.bois; BOIS = analyser(o.bois); }
  }

  function tressage(id) {
    const k = norm(id);
    const t = TRESSAGES[k];
    if (!t) throw new Error('Tressage inconnu : ' + id + '. Tressages : ' + Object.keys(TRESSAGES).join(', '));
    return Object.assign({ id: k }, t);
  }

  /* ================= Familles ================= */

  const FAMILLES = {
    aucune:   { label: 'Aucune nuance', test: () => true },
    naturels: { label: 'Naturels', test: ([d]) => d.id === 'rotin-naturel' || (d.H >= 40 && d.H <= 110 && d.C <= 0.10) || (d.C < 0.03 && d.L > 0.8) },
    rouges:   { label: 'Rouges', test: ([d]) => (d.H >= 330 || d.H < 40) && d.C >= 0.08 },
    verts:    { label: 'Verts', test: ([d]) => d.H >= 108 && d.H < 190 && d.C >= 0.045 },
    bleus:    { label: 'Bleus', test: ([d]) => d.H >= 190 && d.H < 300 && d.C >= 0.025 },
    chauds:   { label: 'Chauds', test: ([d]) => d.H >= 25 && d.H < 108 && d.C >= 0.085 },
    clairs:   { label: 'Clairs', test: cols => cols[0].L >= 0.78 && cols.every(c => c.L >= 0.62) },
    profonds: { label: 'Profonds', test: ([d]) => d.L <= 0.50 }
  };
  const ALIAS_FAMILLE = { 'aucune-nuance': 'aucune', naturel: 'naturels', rouge: 'rouges', vert: 'verts', bleu: 'bleus', chaud: 'chauds', clair: 'clairs', profond: 'profonds' };
  function famille(id) { const k = norm(id || 'aucune'); return FAMILLES[ALIAS_FAMILLE[k] || k] || FAMILLES.aucune; }
  function famillesDe(cols) { return Object.keys(FAMILLES).filter(k => k !== 'aucune' && FAMILLES[k].test(cols)); }

  /* ================= Textes ================= */

  const bas = c => c.nomCourt.toLowerCase();
  const voyelle = s => /^[aeiouyhàâéèêëîïôûü]/i.test(s);
  const du = c => (voyelle(bas(c)) ? "de l'" : 'du ') + bas(c);
  const de = c => (voyelle(bas(c)) ? "d'" : 'de ') + bas(c);
  const le = c => (voyelle(bas(c)) ? "l'" : 'le ') + bas(c);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================= Recettes signatures ================= */
  // Chaque recette décrit des rôles, pas des couleurs figées. À enrichir avec la graphiste.

  const naturel = c => c.id === 'rotin-naturel' || (c.H >= 45 && c.H <= 105 && c.C >= 0.015 && c.C <= 0.09 && c.L >= 0.6);

  const RECETTES = [
    { id: 'terrasse', label: 'Terrasse classique', adj: ['classique', 'intemporel', 'de terrasse'],
      test: (d, s) => (d.clair && s.L <= 0.46) || (s.clair && d.L <= 0.46),
      phrase: (d, s) => `Le contraste ${du(d)} et ${du(s)}, comme sur les terrasses parisiennes.` },
    { id: 'graphique', label: 'Graphique', adj: ['graphique', 'affirmé', 'signature'], tressages: ['damier', 'maille'],
      test: (d, s) => dL(d, s) >= 0.45,
      phrase: (d, s) => `Contraste fort entre ${le(d)} et ${le(s)} : le motif ressort nettement.` },
    { id: 'bistrot', label: 'Bistrot bicolore', adj: ['bistrot', 'franc', 'lumineux'],
      test: (d, s) => d.C >= 0.10 && d.L < 0.8 && s.clair,
      phrase: (d, s) => `${cap(bas(d))} franc, adouci par ${du(s)}.` },
    { id: 'camaieu', label: 'Camaïeu', adj: ['camaïeu', 'velouté', 'ton sur ton'], tressages: ['serge', 'chevron', 'natte', 'bourdon', 'maille'],
      test: (d, s, a) => d.C >= 0.045 && s.C >= 0.045 && dH(d, s) <= 30 && dL(d, s) >= 0.1 && (!a || a.appui || dH(d, a) <= 30),
      phrase: (d, s) => `Camaïeu ${de(d)} et ${bas(s)} pour un rendu velouté.` },
    { id: 'naturel-accent', label: 'Naturel et accent', adj: ['solaire', 'naturel', 'de plage'],
      test: (d, s, a) => naturel(d) && (a || s).C >= 0.11,
      phrase: (d, s, a) => `Base ${bas(d)} réveillée par ${du(a || s)}.` },
    { id: 'profond', label: 'Profond', adj: ['profond', 'feutré', 'nocturne'],
      test: (d, s, a) => d.L <= 0.47 && s.L <= 0.62 && (!a || a.L >= 0.75),
      phrase: (d, s) => `Tons profonds ${de(d)} et ${de(s)}, ambiance feutrée.` },
    { id: 'pastel', label: 'Pastel', adj: ['pastel', 'poudré', 'riviera'],
      test: (d, s) => d.L >= 0.78 && d.C >= 0.05 && s.clair,
      phrase: (d, s) => `${cap(bas(d))} tout en douceur, éclairé par ${du(s)}.` },
    { id: 'complementaire', label: 'Complémentaire doux', adj: ['contrasté', 'vibrant', 'audacieux'],
      test: (d, s) => dH(d, s) >= 150 && Math.min(d.C, s.C) < 0.08 && Math.max(d.C, s.C) >= 0.10,
      phrase: (d, s) => `${cap(bas(d))} réveillé par ${du(s)}, en opposition douce.` }
  ];

  function recettePour(cols, t) {
    const [d, s, a] = cols;
    return RECETTES.find(r => (!r.tressages || r.tressages.includes(t.id)) && r.test(d, s, a)) || null;
  }

  /* ================= Notation du tressage ================= */

  function relation(a, b) {
    if (a.appui || b.appui) return { type: 'neutre', pts: 6 };
    const h = dH(a, b), minC = Math.min(a.C, b.C);
    if (h <= 35) return { type: 'analogue', pts: 6 };
    if (h >= 150) return minC < 0.08 ? { type: 'complementaire-doux', pts: 5 } : { type: 'complementaire-franc', pts: -8 };
    if (minC > 0.08) return { type: 'discordant', pts: -12 };
    return { type: 'tolere', pts: -2 };
  }

  function vibre(a, b) { return a.C > 0.10 && b.C > 0.10 && dL(a, b) < 0.10 && dH(a, b) >= 50 && dH(a, b) <= 170; }

  function noterTressage(cols, t) {
    const R = [];
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      if (dE(cols[i], cols[j]) < CONFIG.ecartMin) return { score: 0, rejet: true, raisons: [{ ok: false, t: 'Deux couleurs trop proches : le motif disparaît.' }] };
    }
    const [d, s, a] = cols;
    let sc = 55;

    // 1. Contraste de clarté adapté au tressage (idéal au centre de la plage)
    const ecart = dL(d, s), [lo, hi] = t.contraste;
    if (ecart < lo) { sc -= (lo - ecart) * 220; R.push({ ok: false, t: `Contraste trop faible pour un ${t.label.toLowerCase()} : le motif se lit mal.` }); }
    else if (ecart > hi) { sc -= (ecart - hi) * 120; R.push({ ok: false, t: `Contraste un peu dur pour un ${t.label.toLowerCase()}.` }); }
    else {
      const mid = (lo + hi) / 2, demi = (hi - lo) / 2;
      sc += 6 + 6 * (1 - Math.abs(ecart - mid) / demi);
      R.push({ ok: true, t: 'Contraste juste pour ce tressage.' });
    }

    // 1b. Structure de valeurs : clair, moyen, foncé bien étagés
    if (!a) sc += 8; // compense l'absence d'accent pour comparer 2 et 3 couleurs
    if (a) {
      const Ls = cols.map(c => c.L), span = Math.max(...Ls) - Math.min(...Ls);
      if (span >= 0.3 && span <= 0.65) sc += 4;
    }

    // 1c. Nombre de teintes : deux familles maximum, sinon ça s'éparpille
    const chrom = cols.filter(c => !c.appui && c.C >= 0.045);
    const groupes = [];
    chrom.forEach(c => { const g = groupes.find(g => dH(g, c) <= 35); if (!g) groupes.push(c); });
    if (groupes.length >= 3) { sc -= 10; R.push({ ok: false, t: 'Trop de teintes différentes.' }); }

    // 1d. Une couleur héroïne plutôt que plusieurs qui crient
    const heroines = cols.filter(c => c.C >= 0.11).length;
    if (heroines === 1) sc += 4;
    if (d.C >= 0.17 && !s.appui) sc -= 4;

    // 2. Budget de couleurs vives
    const vifs = cols.filter(c => c.C >= 0.13);
    if (vifs.length >= 2) {
      let proches = true;
      for (let i = 0; i < vifs.length; i++) for (let j = i + 1; j < vifs.length; j++) if (dH(vifs[i], vifs[j]) > 35) proches = false;
      if (!proches) { sc -= 20; R.push({ ok: false, t: 'Trop de couleurs vives qui se disputent.' }); }
    }

    // 3. Vibration
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      if (vibre(cols[i], cols[j])) { sc -= 22; R.push({ ok: false, t: `${cap(bas(cols[i]))} et ${bas(cols[j])} vibrent entre elles.` }); }
    }

    // 4. Relations de teinte
    const rel = relation(d, s);
    sc += rel.pts;
    if (a) sc += (relation(d, a).pts + relation(s, a).pts) / 2;

    // 5. Couleur d'appui
    const tousAnalogues = cols.every(c => c.appui || dH(c, d) <= 35);
    if (!cols.some(c => c.appui) && !tousAnalogues) { sc -= 8; R.push({ ok: false, t: "Aucune couleur d'équilibre pour poser l'ensemble." }); }

    // 6. Visibilité de l'accent
    if (a) {
      if (Math.min(dE(a, d), dE(a, s)) < 0.10) { sc -= 6; R.push({ ok: false, t: "L'accent se voit peu." }); }
      else if (a.C >= 0.10 || dL(a, d) >= 0.25) sc += 4;
    }

    // 7. Mélange optique vu de loin
    const mix = melange(cols, t.couverture);
    const cMoy = cols.reduce((acc, c, i) => acc + c.C * (t.couverture[i] || 0), 0);
    if (cMoy > 0.07 && mix.C < 0.4 * cMoy && mix.L > 0.3 && mix.L < 0.72) { sc -= 16; R.push({ ok: false, t: 'Vu de loin, le mélange devient terne.' }); }

    // 7b. Retenue : un ensemble trop saturé fatigue sur une terrasse entière
    if (cMoy > 0.13) { sc -= (cMoy - 0.13) * 120; R.push({ ok: false, t: 'Ensemble très saturé.' }); }

    // 8. Structure bois
    if (dE(d, BOIS) < 0.06) { sc -= 10; R.push({ ok: false, t: 'La dominante se confond avec la structure bois.' }); }

    // 9. Ensemble trop fade
    if (cols.every(c => c.C < 0.045) && ecart < 0.3) { sc -= 5; R.push({ ok: false, t: 'Ensemble un peu fade.' }); }

    return { score: Math.max(0, Math.min(100, Math.round(sc))), raisons: R, mix, relation: rel.type };
  }

  /* ================= Contours ================= */

  const CLASSIQUES = ['blanc', 'noir', 'ecru', 'ivoire', 'rotin-naturel', 'anthracite'];
  const STYLES_CONTOUR = { 'ton-sur-ton': 'Ton sur ton', echo: 'Écho du tressage', neutre: 'Neutre', accent: 'Signature' };

  function noterContour(cols, c, mix) {
    const d = cols[0];
    let sc = 70, style;
    const idx = cols.findIndex(x => x.id === c.id);
    if (idx === 0) { style = 'ton-sur-ton'; sc += 6; }
    else if (idx > 0) { style = 'echo'; sc += 14; }
    else if (c.appui || c.metallise || c.id === 'rotin-naturel') {
      style = 'neutre'; sc += 6 + (CLASSIQUES.includes(c.id) ? 4 : 0);
      // cohérence de température entre le contour neutre et le tressage
      const neutreChaud = !c.metallise && c.C >= 0.02 && c.H >= 40 && c.H <= 110;
      const neutreFroid = !c.metallise && c.C >= 0.015 && c.H >= 180 && c.H <= 300;
      const tressageFroid = mix.C >= 0.035 && mix.H >= 150 && mix.H <= 300;
      const tressageChaud = mix.C >= 0.035 && (mix.H < 110 || mix.H > 330);
      if (neutreChaud && tressageFroid) sc -= 6;
      if (neutreFroid && tressageChaud) sc -= 4;
    }
    else {
      style = 'accent'; sc -= 10;
      if (cols.some(x => x.C >= 0.045 && dH(x, c) <= 25)) sc += 8;
      if (c.C >= 0.13 && cols.some(x => x.C >= 0.13 && dH(x, c) > 35)) sc -= 15;
    }
    const lisible = Math.abs(c.L - mix.L);
    let note = '';
    if (style !== 'ton-sur-ton') {
      if (lisible < 0.10) { sc -= 18; note = 'Le contour se perd dans le tressage.'; }
      else if (lisible >= 0.25) { sc += 8; note = "Le contour dessine l'assise."; }
    }
    if (vibre(c, d)) sc -= 15;
    // le contour touche la structure bois : il doit s'en détacher
    const ecartBois = dE(c, BOIS);
    if (ecartBois < 0.12) sc -= Math.round((0.12 - ecartBois) * 100);
    return { id: c.id, nom: c.nom, hex: c.hex, style, styleLabel: STYLES_CONTOUR[style], score: Math.max(0, Math.min(100, Math.round(sc))), note };
  }

  // Classe les contours possibles, en variant les styles
  function contoursPour(cols, t, n, styleVoulu) {
    cols = cols.map(couleur).filter(Boolean);
    t = typeof t === 'string' ? tressage(t) : t;
    const mix = melange(cols, t.couverture);
    const tous = PALETTE.filter(c => c.roles.includes('contour')).map(c => noterContour(cols, c, mix)).sort((x, y) => y.score - x.score);
    const choix = [];
    if (styleVoulu && styleVoulu !== 'auto') { const p = tous.find(x => x.style === norm(styleVoulu)); if (p) choix.push(p); }
    for (const c of tous) { if (choix.length >= (n || 3)) break; if (!choix.some(x => x.style === c.style)) choix.push(c); }
    for (const c of tous) { if (choix.length >= (n || 3)) break; if (!choix.includes(c)) choix.push(c); }
    return choix;
  }

  /* ================= Génération ================= */

  function pool(role) { return PALETTE.filter(c => c.roles.includes(role)); }

  function generer(t, fam, verrous, o) {
    const pools = t.slots.map((slot, i) => verrous[slot] ? [couleur(verrous[slot])].filter(Boolean) : pool(ROLES[i] || 'accent'));
    const contourFixe = verrous.contour ? couleur(verrous.contour) : null;
    const seuil = o.seuil !== undefined ? o.seuil : CONFIG.seuil;
    const brut = [];
    const essayer = cols => {
      if (!fam.test(cols)) return;
      const r = noterTressage(cols, t);
      if (r.rejet || r.score < seuil - 10) return;
      const rec = recettePour(cols, t);
      brut.push({ cols, r, rec, base: Math.min(100, r.score + (rec ? 5 : 0)) });
    };
    if (t.slots.length === 2) {
      for (const d of pools[0]) for (const s of pools[1]) if (s.id !== d.id) essayer([d, s]);
    } else {
      for (const d of pools[0]) for (const s of pools[1]) {
        if (s.id === d.id || dE(d, s) < CONFIG.ecartMin) continue;
        if (t.contraste[0] - dL(d, s) > 0.15) continue; // contraste trop faible, inutile d'aller plus loin
        for (const a of pools[2]) if (a.id !== d.id && a.id !== s.id) essayer([d, s, a]);
      }
    }
    brut.sort((x, y) => y.base - x.base);
    const top = brut.slice(0, 250);
    const pc = CONFIG.poidsContour;
    return top.map(x => {
      let contour, alternatives;
      if (contourFixe) {
        contour = noterContour(x.cols, contourFixe, x.r.mix);
        alternatives = [contour];
      } else {
        alternatives = contoursPour(x.cols, t, 3, o.styleContour);
        contour = alternatives[0];
      }
      return Object.assign(x, { contour, alternatives, total: Math.round(x.base * (1 - pc) + contour.score * pc) });
    }).filter(x => x.total >= seuil);
  }

  /* ================= Sélection variée ================= */

  function rngDe(graine) {
    if (graine === undefined || graine === null) return Math.random;
    let h = typeof graine === 'number' ? graine : [...String(graine)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
    return function () { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function selectionner(cands, n, rng, alea, exclure) {
    const ex = new Set(exclure || []);
    const reste = cands.filter(c => !ex.has(cleDe(c))).sort((a, b) => b.total - a.total).slice(0, 150);
    const pris = [];
    while (pris.length < n && reste.length) {
      let best = -1e9, bi = 0;
      reste.forEach((c, i) => {
        let v = c.total + (rng() - 0.5) * 2 * alea;
        for (const p of pris) {
          if (p.cols[0].id === c.cols[0].id) v -= 25;
          if (p.cols[1].id === c.cols[1].id) v -= 6;
          const ids = new Set(p.cols.map(x => x.id));
          if (c.cols.every(x => ids.has(x.id))) v -= 60;
          if (dE(p.r.mix, c.r.mix) < 0.05) v -= 18;
          if (p.rec && c.rec && p.rec.id === c.rec.id) v -= 4;
          if (p.contour.id === c.contour.id) v -= 6;
        }
        if (v > best) { best = v; bi = i; }
      });
      pris.push(reste.splice(bi, 1)[0]);
    }
    return pris;
  }

  /* ================= Mise en forme ================= */

  function cleDe(x) { return x.cols.map(c => c.id).join('+'); }

  function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

  function nomAlliance(cols, rec) {
    const d = cols[0];
    let adjs = rec ? rec.adj : d.L >= 0.8 ? ['lumineux', 'léger', 'solaire'] : d.L <= 0.5 ? ['profond', 'élégant', 'dense'] : d.C >= 0.13 ? ['vif', 'éclatant', 'joyeux'] : ['élégant', 'doux', 'harmonieux'];
    return cap(d.nomCourt) + ' ' + adjs[hash(cleDe({ cols })) % adjs.length];
  }

  function pourquoi(cols, rec, relationType, contour) {
    const [d, s, a] = cols;
    let p;
    if (rec) p = rec.phrase(d, s, a);
    else if (relationType === 'neutre') p = `${cap(bas(d))} équilibré par ${du(s)}.`;
    else if (relationType === 'analogue') p = `${cap(bas(d))} et ${bas(s)} dans la même famille de teinte.`;
    else if (relationType === 'complementaire-doux') p = `${cap(bas(d))} réveillé par ${du(s)}, en opposition douce.`;
    else p = `${cap(bas(d))} associé à ${du(s)}.`;
    if (a && !(rec && rec.id === 'naturel-accent')) p += ` Accent ${bas(a)} pour rythmer le tressage.`;
    if (contour) {
      const c = couleur(contour.id);
      if (contour.style === 'echo') p += ` Contour ${bas(c)} repris du tressage.`;
      else if (contour.style === 'neutre') p += ` Contour ${bas(c)} qui encadre l'assise.`;
      else if (contour.style === 'ton-sur-ton') p += ' Contour ton sur ton, très discret.';
      else p += ` Contour ${bas(c)} en signature.`;
    }
    return p;
  }

  function finaliser(x, t) {
    const couleurs = {}, slots = {};
    t.slots.forEach((slot, i) => { couleurs[slot] = x.cols[i].id; slots[slot] = x.cols[i].hex; });
    slots[CONFIG.contourSlot] = x.contour.hex;
    return {
      id: t.id + ':' + cleDe(x) + ':' + x.contour.id,
      cle: cleDe(x),
      nom: nomAlliance(x.cols, x.rec),
      tressage: t.id,
      couleurs,
      contour: x.contour.id,
      slots,
      score: Math.min(100, x.note !== undefined ? x.note : x.total),
      valide: !!x.valide,
      scoreTressage: x.r.score,
      scoreContour: x.contour.score,
      recette: x.rec ? x.rec.id : null,
      recetteLabel: x.rec ? x.rec.label : null,
      familles: famillesDe(x.cols),
      pourquoi: pourquoi(x.cols, x.rec, x.r.relation, x.contour),
      raisons: x.r.raisons,
      contoursAlternatifs: x.alternatives.map(c => ({ id: c.id, nom: c.nom, hex: c.hex, style: c.style, styleLabel: c.styleLabel, score: c.score })),
      melangeHex: x.r.mix.hex
    };
  }

  /* ================= API publique ================= */

  function depuisValides(t, fam, verrous) {
    if (!VALIDES) return [];
    return VALIDES.filter(v => v.tressage === t.id).map(v => {
      const cols = t.slots.map(s => couleur(v.couleurs[s]));
      if (cols.some(c => !c)) return null;
      if (!fam.test(cols)) return null;
      if (t.slots.some(s => verrous[s] && couleur(verrous[s]) && couleur(verrous[s]).id !== v.couleurs[s])) return null;
      const r = noterTressage(cols, t);
      const rec = recettePour(cols, t);
      const contourCol = couleur(verrous.contour || v.contour);
      const contour = noterContour(cols, contourCol, r.mix);
      if (verrous.contour && contour.score < CONFIG.seuil) return null;
      const alternatives = verrous.contour ? [contour] : [contour].concat(contoursPour(cols, t, 3).filter(c => c.id !== contour.id)).slice(0, 3);
      const note = Math.round(r.score * (1 - CONFIG.poidsContour) + contour.score * CONFIG.poidsContour);
      // les alliances validées passent devant la génération automatique
      return { cols, r, rec, contour, alternatives, note, valide: true, total: note + 30 };
    }).filter(Boolean);
  }

  /**
   * Propose des alliances.
   * o.tressage      'maille' | 'damier' | 'serge' | 'chevron' | 'natte' | 'bourdon'
   * o.famille       'aucune' | 'naturels' | 'rouges' | 'verts' | 'bleus' | 'chauds' | 'clairs' | 'profonds'
   * o.verrous       { c1:'rouge-bordeaux', contour:'noir' } : cases imposées par le client
   * o.styleContour  'auto' | 'echo' | 'neutre' | 'ton-sur-ton' | 'accent'
   * o.n             nombre de propositions (6 par défaut)
   * o.graine        pour des résultats reproductibles
   * o.alea          dose de hasard (8 par défaut, 0 = toujours les meilleures)
   * o.exclure       clés déjà montrées (bouton "autres idées")
   */
  function recommander(o) {
    o = o || {};
    if (!PALETTE.length) throw new Error('Palette non chargée : appeler charger(palette) avant.');
    const t = tressage(o.tressage || 'maille');
    const fam = famille(o.famille);
    const verrous = o.verrous || {};
    const n = o.n || 6;
    let cands = o.live ? [] : depuisValides(t, fam, verrous);
    // la liste validée suffit dès qu'elle offre assez de choix, sinon on complète par la génération
    if (cands.length < n * 2) cands = cands.concat(generer(t, fam, verrous, o));
    const vus = new Set();
    cands = cands.filter(c => { const k = cleDe(c) + '|' + c.contour.id; if (vus.has(k)) return false; vus.add(k); return true; });
    const choix = selectionner(cands, n, rngDe(o.graine), o.alea === undefined ? 8 : o.alea, o.exclure);
    return choix.map(x => finaliser(x, t));
  }

  /**
   * Diagnostic d'une configuration manuelle.
   * o.tressage, o.couleurs { c1, c2, c3, contour }
   */
  function diagnostiquer(o) {
    const t = tressage(o.tressage);
    const cols = t.slots.map(s => couleur(o.couleurs[s]));
    if (cols.some(c => !c)) return { score: null, niveau: 'incomplet', conseils: ['Choisis toutes les couleurs du tressage.'] };
    const r = noterTressage(cols, t);
    const contourCol = couleur(o.couleurs.contour || o.couleurs[CONFIG.contourSlot]);
    const contour = contourCol ? noterContour(cols, contourCol, r.mix) : null;
    const suggestions = contoursPour(cols, t, 3);
    const total = contour ? Math.round(r.score * (1 - CONFIG.poidsContour) + contour.score * CONFIG.poidsContour) : r.score;
    const conseils = r.raisons.filter(x => !x.ok).map(x => x.t);
    if (contour && contour.note && contour.score < 65) conseils.push(contour.note);
    return {
      score: total,
      niveau: total >= 80 ? 'excellent' : total >= 65 ? 'bon' : 'a-revoir',
      conseils,
      contour,
      contoursSuggeres: suggestions,
      recette: (recettePour(cols, t) || {}).label || null,
      melangeHex: r.mix.hex
    };
  }

  function chargerValides(json) {
    VALIDES = Array.isArray(json) ? json : (json && json.valides) || null;
    return VALIDES ? VALIDES.length : 0;
  }

  return {
    CONFIG, TRESSAGES, FAMILLES, RECETTES, STYLES_CONTOUR,
    charger, chargerValides, configurer, couleur,
    recommander, diagnostiquer, contoursPour,
    palette: () => PALETTE.slice(),
    outils: { analyser, dE, dL, dH, melange, norm }
  };
});
