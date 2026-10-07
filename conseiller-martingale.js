/*
  Conseiller Martingale v2
  Harmonies de couleurs par ambiance (thème), pour le configurateur CHR.

  Principe
    1. Chaque ambiance décrit ses couleurs par rôle : dominante, équilibre, accent, contour.
       Ce sont des choix de direction artistique, à ajuster ici, sans toucher au moteur.
    2. Le moteur combine ces couleurs, élimine ce qui ne tient pas (motif illisible,
       couleurs qui vibrent ou se battent, trop de couleurs vives), note le reste.
    3. Les harmonies « signatures » de chaque ambiance passent en priorité.
    4. La sélection varie les propositions et se souvient de ce qui a déjà été montré.

  Espace colorimétrique : OKLab (L clarté 0..1, C saturation, H teinte en degrés).
  Navigateur : window.ConseillerMartingale ; Node : require('./conseiller-martingale.js')
  API : charger, configurer, couleur, recommander, diagnostiquer, contoursPour, THEMES
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConseillerMartingale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= Tressages ================= */

  // slots : cases du tressage dans l'ordre des rôles (dominante, équilibre, accent)
  // echo  : cases qui reprennent la couleur d'un autre rôle (4e couleur Maille et Damier)
  // lisible : écart de clarté minimal entre dominante et équilibre pour que le motif se lise
  const TRESSAGES = {
    maille:  { label: 'Maille',  slots: ['c1', 'c3', 'c2'], echo: { c5: 'c1' }, lisible: 0.12 },
    damier:  { label: 'Damier',  slots: ['c1', 'c3', 'c2'], echo: { c5: 'c1' }, lisible: 0.16 },
    natte:   { label: 'Natté',   slots: ['c1', 'c2', 'c3'], lisible: 0.10 },
    serge:   { label: 'Sergé',   slots: ['c1', 'c2'], lisible: 0.08 },
    chevron: { label: 'Chevron', slots: ['c1', 'c2'], lisible: 0.08 },
    bourdon: { label: 'Bourdon', slots: ['c1', 'c2'], lisible: 0.08 }
  };
  const CONFIG = { contourSlot: 'c4', bois: '#7A5230' };

  /* ================= Ambiances ================= */

  // Les identifiants absents de la palette sont ignorés (ex. couleurs pas encore au nuancier).
  // contraste : écart de clarté souhaité entre dominante et équilibre [min, max]
  // vifs      : nombre maximal de couleurs très saturées dans le tressage
  // signatures: harmonies choisies à la main [dominante, équilibre, accent, contour]
  const THEMES = {
    brasserie: {
      label: 'Brasserie parisienne', contraste: [0.35, 0.8], vifs: 1,
      dom: ['noir', 'bordeaux', 'rouge', 'sapin', 'bleu-marine', 'bleu-nuit', 'anthracite', 'marron', 'vert-emeraude'],
      eq: ['blanc', 'ivoire', 'creme', 'ecru'],
      acc: ['or', 'rouge', 'bordeaux', 'sapin', 'bleu-roi', 'noir', 'naturel', 'moutarde'],
      contour: ['blanc', 'noir', 'creme', 'ecru'],
      signatures: [['noir', 'blanc', 'or', 'blanc'], ['bordeaux', 'creme', 'noir', 'creme'], ['sapin', 'ivoire', 'bordeaux', 'ivoire'],
        ['bleu-marine', 'blanc', 'rouge', 'blanc'], ['rouge', 'blanc', 'noir', 'noir'], ['noir', 'creme', 'bordeaux', 'creme']],
      noms: ['Grand café', 'Boulevard', 'Zinc', 'Comptoir', 'Rive gauche', 'Terrasse du matin'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, le duo des grandes brasseries. Indémodable.`,
        (d, e) => `Le contraste ${du(d)} et ${du(e)}, comme sur les terrasses des boulevards.`,
        (d, e) => `${Le(d)} donne le ton, ${le(e)} éclaire l'assise. Paris, tout simplement.`,
        (d, e) => `Un classique de brasserie : ${bas(d)} et ${bas(e)}, net et élégant.`
      ]
    },
    riviera: {
      label: 'Riviera', contraste: [0.12, 0.5], vifs: 2,
      dom: ['ciel', 'bleu', 'turquoise', 'jaune-pastel', 'rose', 'peche', 'vert-344', 'lavende', 'saumon'],
      eq: ['blanc', 'ivoire', 'creme'],
      acc: ['bleu-roi', 'bleu-marine', 'rouge', 'orange', 'framboise', 'jaune', 'rouge-eau', 'turquoise'],
      contour: ['blanc', 'ivoire', 'bleu-marine', 'bleu-roi'],
      signatures: [['ciel', 'blanc', 'bleu-marine', 'blanc'], ['jaune-pastel', 'blanc', 'bleu-roi', 'blanc'], ['rose', 'creme', 'rouge-eau', 'creme'],
        ['turquoise', 'ivoire', 'orange', 'ivoire'], ['bleu', 'blanc', 'jaune', 'blanc']],
      noms: ['Riviera', 'Promenade', 'Dolce vita', 'Cabine de plage', 'Port de pêche', 'Glacier'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, un parfum de Méditerranée. Frais du matin au soir.`,
        (d, e) => `Doux et solaire : ${bas(d)} et ${bas(e)}, comme une glace en terrasse.`,
        (d, e) => `${Le(d)} sur fond ${de(e)} : on entend presque les vagues.`,
        (d, e) => `L'esprit Riviera, ${bas(d)} et ${bas(e)}. Léger, lumineux, joyeux.`
      ]
    },
    cotebasque: {
      label: 'Côte basque', contraste: [0.3, 0.8], vifs: 1,
      dom: ['rouge', 'bordeaux', 'sapin', 'vert-emeraude', 'kaki', 'bleu-marine'],
      eq: ['blanc', 'ecru', 'creme', 'ivoire'],
      acc: ['rouge', 'sapin', 'vert-emeraude', 'bordeaux', 'bleu-marine', 'noir', 'vert-eau'],
      contour: ['blanc', 'rouge', 'sapin', 'ecru'],
      signatures: [['rouge', 'blanc', 'sapin', 'blanc'], ['sapin', 'blanc', 'rouge', 'blanc'], ['bordeaux', 'ecru', 'sapin', 'ecru'],
        ['bleu-marine', 'blanc', 'rouge', 'blanc'], ['vert-emeraude', 'blanc', 'rouge', 'blanc']],
      noms: ['Pays basque', 'Fronton', 'Txoko', 'Linge basque', 'Piment', 'Grande plage'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, les couleurs du linge basque. Franc et chaleureux.`,
        (d, e) => `${Le(d)} sur ${le(e)} : un air de fête de village, entre océan et montagne.`,
        (d, e) => `L'esprit de la côte basque, ${bas(d)} et ${bas(e)}. Simple et vivant.`,
        (d, e) => `${Le(d)} pour le caractère, ${le(e)} pour la lumière de l'océan.`
      ]
    },
    barvin: {
      label: 'Bar à vin', contraste: [0.2, 0.6], vifs: 1,
      dom: ['bordeaux', 'prune', 'marron', 'chocolat', 'olive', 'sapin', 'noir', 'bleu-marine', 'anthracite'],
      eq: ['ecru', 'creme', 'naturel', 'kaki', 'gris', 'ivoire', 'greige'],
      acc: ['or', 'bronze', 'rouge-eau', 'orange', 'framboise', 'moutarde', 'terracotta-brique', 'bordeaux'],
      contour: ['noir', 'marron', 'chocolat', 'creme', 'ecru'],
      signatures: [['bordeaux', 'creme', 'or', 'bordeaux'], ['prune', 'naturel', 'noir', 'noir'], ['marron', 'ecru', 'orange', 'marron'],
        ['olive', 'creme', 'bordeaux', 'olive'], ['noir', 'naturel', 'bordeaux', 'noir']],
      noms: ['Bar à vin', 'Cave', 'Fin de soirée', 'Velours', 'Tannin', 'Comptoir à vin'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, une ambiance feutrée de fin de soirée.`,
        (d, e) => `Des tons profonds, ${bas(d)} et ${bas(e)}. Chic et enveloppant, comme un bon verre.`,
        (d, e) => `${Le(d)} réchauffé par ${le(e)} : parfait pour une cave ou une salle tamisée.`,
        (d, e) => `${Le(d)} et ${le(e)}, tout en rondeur. On s'y attarde volontiers.`
      ]
    },
    hotelchic: {
      label: 'Hôtel chic', contraste: [0.2, 0.75], vifs: 0,
      dom: ['creme', 'ecru', 'gris', 'vert-2260', 'vert-diamant', 'ivoire', 'olive', 'greige', 'taupe', 'sauge'],
      eq: ['noir', 'olive', 'marron', 'chocolat', 'bleu-marine', 'kaki', 'anthracite', 'bleu-nuit'],
      acc: ['or', 'bronze', 'argent', 'bordeaux', 'sapin', 'noir'],
      contour: ['noir', 'creme', 'ecru', 'olive', 'marron'],
      signatures: [['creme', 'noir', 'or', 'noir'], ['vert-2260', 'olive', 'or', 'olive'], ['ecru', 'bleu-marine', 'or', 'ecru'],
        ['gris', 'noir', 'argent', 'noir'], ['ivoire', 'chocolat', 'bronze', 'chocolat']],
      noms: ['Lobby', 'Palace', 'Salon', 'Suite', 'Patio', 'Hôtel particulier'],
      phrases: [
        (d, e) => `${Le(d)} tout en retenue, souligné par ${le(e)}. Le luxe discret.`,
        (d, e) => `${Le(d)} et ${le(e)} : une élégance calme, digne d'un beau lobby.`,
        (d, e) => `Des teintes posées, ${bas(d)} et ${bas(e)}. Chic sans jamais en faire trop.`,
        (d, e) => `${Le(d)} pour la douceur, ${le(e)} pour la tenue. Très hôtel particulier.`
      ]
    },
    plage: {
      label: 'Bord de mer', contraste: [0.1, 0.6], vifs: 1,
      dom: ['naturel', 'creme', 'ecru', 'ivoire', 'ciel', 'turquoise'],
      eq: ['blanc', 'naturel', 'bleu-marine', 'sapin', 'ecru', 'bleu-nuit'],
      acc: ['orange', 'jaune', 'terracotta', 'rouge-eau', 'turquoise', 'bleu', 'bleu-roi', 'rouge'],
      contour: ['blanc', 'naturel', 'ecru', 'bleu-marine'],
      signatures: [['naturel', 'blanc', 'bleu-marine', 'blanc'], ['ecru', 'bleu-marine', 'rouge-eau', 'ecru'], ['creme', 'naturel', 'turquoise', 'naturel'],
        ['ivoire', 'sapin', 'orange', 'ivoire'], ['ciel', 'blanc', 'rouge', 'blanc']],
      noms: ['Paillote', 'Bord de mer', 'Sieste au soleil', 'Marée haute', 'Cabanon', 'Grande bleue'],
      phrases: [
        (d, e) => `Une base ${bas(d)} toute naturelle avec ${le(e)}. Un air de vacances.`,
        (d, e) => `${Le(d)} et ${le(e)}, comme le sable et l'écume. Les pieds dans l'eau.`,
        (d, e) => `L'esprit paillote : ${bas(d)} et ${bas(e)}, simple et lumineux.`,
        (d, e) => `${Le(d)} et ${le(e)} pour une terrasse face à la mer.`
      ]
    },
    guinguette: {
      label: 'Guinguette', contraste: [0.15, 0.6], vifs: 1,
      dom: ['vert-2260', 'vert-diamant', 'vert-344', 'kaki', 'vert-pomme', 'vert-citron', 'sapin', 'jaune-pastel', 'sauge', 'vert-eau'],
      eq: ['blanc', 'creme', 'ecru', 'ivoire'],
      acc: ['rose', 'framboise', 'rouge-eau', 'orange', 'jaune', 'lavende', 'rouge', 'vieux-rose'],
      contour: ['blanc', 'creme', 'sapin', 'kaki'],
      signatures: [['vert-2260', 'blanc', 'framboise', 'blanc'], ['sapin', 'creme', 'rose', 'creme'], ['vert-344', 'ecru', 'rouge-eau', 'ecru'],
        ['kaki', 'ivoire', 'orange', 'kaki'], ['vert-diamant', 'blanc', 'lavende', 'blanc']],
      noms: ['Guinguette', 'Bord de Marne', "Jardin d'été", 'Tonnelle', 'Pique-nique', 'Dimanche au vert'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)}, comme une tonnelle un dimanche d'été.`,
        (d, e) => `Du vert, de la fraîcheur : ${bas(d)} et ${bas(e)}. On a envie de rester dehors.`,
        (d, e) => `${Le(d)} sur ${le(e)} : l'esprit guinguette, gai et sans façon.`,
        (d, e) => `${Le(d)} et ${le(e)}, un jardin en terrasse.`
      ]
    },
    pop: {
      label: 'Pop graphique', contraste: [0.25, 0.9], vifs: 3, osé: true,
      dom: ['jaune', 'orange', 'framboise', 'bleu-roi', 'turquoise', 'vert-citron', 'rose', 'rouge', 'fushia'],
      eq: ['blanc', 'noir', 'bleu-marine', 'creme'],
      acc: ['jaune', 'orange', 'framboise', 'bleu-roi', 'turquoise', 'vert-citron', 'rose', 'rouge', 'bleu'],
      contour: ['noir', 'blanc'],
      signatures: [['jaune', 'blanc', 'bleu-roi', 'noir'], ['framboise', 'blanc', 'orange', 'blanc'], ['bleu-roi', 'blanc', 'jaune', 'bleu-roi'],
        ['vert-citron', 'noir', 'rose', 'noir'], ['orange', 'blanc', 'bleu-roi', 'blanc']],
      noms: ['Pop', 'Néon', 'Coup d\'éclat', 'Rooftop', 'Club', 'Graphique'],
      phrases: [
        (d, e) => `${Le(d)} et ${le(e)} face à face : le motif claque, même de loin.`,
        (d, e) => `${Le(d)} en vedette, ${le(e)} pour la netteté. Impossible de passer à côté.`,
        (d, e) => `Un duo audacieux, ${bas(d)} et ${bas(e)}. Fait pour être photographié.`,
        (d, e) => `${Le(d)} et ${le(e)}, énergie maximale. L'esprit rooftop.`
      ]
    }
  };
  const ORDRE_THEMES = ['brasserie', 'riviera', 'cotebasque', 'barvin', 'hotelchic', 'plage', 'guinguette', 'pop'];

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

  /* ================= Palette ================= */

  let PALETTE = [], PAR_ID = {}, BOIS = analyser(CONFIG.bois);

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function charger(palette) {
    const liste = Array.isArray(palette) ? palette : palette.couleurs;
    if (palette && palette.bois && palette.bois.hex) BOIS = analyser(palette.bois.hex);
    PALETTE = []; PAR_ID = {};
    liste.forEach(e => {
      if (!e || !e.hex || e.actif === false) return;
      const c = Object.assign({}, e, analyser(e.hex));
      c.nomCourt = (e.nomConseiller || e.nom || e.id).trim();
      c.neutre = c.C < 0.045;
      c.vif = c.C >= 0.13;
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
  const voyelle = s => /^[aeiouyhàâéèêëîïôûü]/i.test(s);
  const du = c => (voyelle(bas(c)) ? "de l'" : 'du ') + bas(c);
  const de = c => (voyelle(bas(c)) ? "d'" : 'de ') + bas(c);
  const le = c => (voyelle(bas(c)) ? "l'" : 'le ') + bas(c);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const Le = c => cap(le(c));
  function hash(s) { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
  const pick = (liste, cle) => liste[hash(cle) % liste.length];

  const ACCENTS = [
    a => `Une pointe ${de(a)} fait vibrer le motif.`,
    a => `${Le(a)} en touche, pour le rythme.`,
    a => `Et une note ${de(a)} qui attire l'œil.`,
    a => `${Le(a)} vient réveiller le tressage.`
  ];
  const CONTOURS = {
    echo: [c => `Contour ${bas(c)}, repris du tressage.`, c => `Le contour reprend ${le(c)} : tout est relié.`],
    neutre: [c => `Contour ${bas(c)} pour encadrer l'assise.`, c => `Un contour ${bas(c)}, sobre, qui met le motif en valeur.`],
    signature: [c => `Contour ${bas(c)} en signature.`, c => `Et un contour ${bas(c)} pour signer l'ensemble.`]
  };
  const STYLE_LABEL = { echo: 'Écho du tressage', neutre: 'Neutre', signature: 'Signature' };

  /* ================= Notation ================= */

  // Note un trio (ou duo) dans une ambiance. Renvoie null si l'harmonie ne tient pas.
  function noter(cols, theme, t) {
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (dE(cols[i], cols[j]) < 0.07) return null;
    const [d, e, a] = cols;
    if (dL(d, e) < t.lisible) return null;                       // le motif disparaîtrait
    let sc = 70;
    // Contraste souhaité par l'ambiance
    const [lo, hi] = theme.contraste, ec = dL(d, e);
    if (ec < lo) sc -= (lo - ec) * 90; else if (ec > hi) sc -= (ec - hi) * 60; else sc += 8;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const x = cols[i], y = cols[j];
      // deux couleurs vives de même clarté et de teintes éloignées : ça vibre
      if (x.C > 0.1 && y.C > 0.1 && dL(x, y) < 0.1 && dH(x, y) >= 50) sc -= theme.osé ? 8 : 25;
      // teintes qui se battent (ni proches, ni opposées) entre deux couleurs franches
      else if (x.C > 0.09 && y.C > 0.09 && dH(x, y) > 50 && dH(x, y) < 140) sc -= theme.osé ? 2 : 10;
    }
    // Budget de couleurs vives
    const vifs = cols.filter(c => c.vif).length;
    if (vifs > theme.vifs) sc -= (vifs - theme.vifs) * 14;
    // L'accent doit se voir
    if (a) {
      const vu = Math.min(dE(a, d), dE(a, e));
      if (vu < 0.1) sc -= 12; else sc += Math.min(8, vu * 30);
    }
    // La dominante ne doit pas se confondre avec la structure en bois
    if (dE(d, BOIS) < 0.06) sc -= 10;
    return { score: sc };
  }

  // Contours : tirés de l'ambiance, notés selon le bois et le tressage
  function contoursPour(cols, theme, n) {
    const res = ids(theme.contour).map(c => {
      let sc = 60, style;
      if (cols.some(x => x.id === c.id)) { style = 'echo'; sc += 10; }
      else if (c.neutre || c.L > 0.88) { style = 'neutre'; sc += 6; }
      else style = 'signature';
      if (dE(c, BOIS) < 0.08) sc -= 20;                           // se perd sur le bois
      sc += Math.min(10, dE(c, cols[0]) * 20);                     // se détache de la dominante
      return { id: c.id, nom: c.nom, hex: c.hex, style, styleLabel: STYLE_LABEL[style], score: Math.round(sc) };
    }).sort((x, y) => y.score - x.score);
    return res.slice(0, n || 3);
  }

  /* ================= Génération ================= */

  function cleDe(x) { return x.cols.map(c => c.id).join('+'); }

  function candidatsTheme(themeId, t) {
    const th = THEMES[themeId];
    const D = ids(th.dom), E = ids(th.eq), A = ids(th.acc);
    const out = [];
    const ajouter = (cols, sig) => {
      const r = noter(cols, th, t);
      if (!r) return;
      out.push({ cols, theme: themeId, score: r.score + (sig !== undefined ? 14 : 0), signature: sig !== undefined, sigContour: sig || null });
    };
    // Harmonies signatures d'abord
    (th.signatures || []).forEach(s => {
      const c = ids(s.slice(0, t.slots.length));
      if (c.length === t.slots.length) ajouter(c, couleur(s[3]) ? s[3] : null);
    });
    if (t.slots.length === 2) {
      const seconds = E.concat(A.filter(x => !E.includes(x)));
      for (const d of D) for (const e of seconds) if (d.id !== e.id) ajouter([d, e]);
    } else {
      for (const d of D) for (const e of E) for (const a of A) if (d.id !== e.id && a.id !== d.id && a.id !== e.id) ajouter([d, e, a]);
    }
    // une même combinaison peut venir d'une signature et de la génération : on garde la meilleure
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
  function selectionner(cands, n, rng, alea, exclure) {
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
          if (p.theme === c.theme) v -= 6;
        }
        if (v > best) { best = v; bi = i; }
      });
      pris.push(reste.splice(bi, 1)[0]);
    }
    return pris;
  }

  // Pas deux fois le même nom d'alliance dans un même lot
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
      const sig = deja || { id: c.id, nom: c.nom, hex: c.hex, style: x.cols.some(y => y.id === c.id) ? 'echo' : (c.neutre || c.L > 0.88 ? 'neutre' : 'signature'), score: 80 };
      sig.styleLabel = STYLE_LABEL[sig.style];
      alternatives = [sig].concat(alternatives.filter(y => y.id !== c.id)).slice(0, 3);
    }
    const contour = alternatives[0];
    const couleurs = {}, slots = {};
    t.slots.forEach((slot, i) => { couleurs[slot] = x.cols[i].id; slots[slot] = x.cols[i].hex; });
    Object.keys(t.echo || {}).forEach(slot => { couleurs[slot] = couleurs[t.echo[slot]]; slots[slot] = slots[t.echo[slot]]; });
    slots[CONFIG.contourSlot] = contour.hex;
    const cle = cleDe(x);
    let pourquoi = pick(th.phrases, cle)(d, e);
    if (a) pourquoi += ' ' + pick(ACCENTS, cle + 'a')(a);
    pourquoi += ' ' + pick(CONTOURS[contour.style] || CONTOURS.signature, cle + 'c')(couleur(contour.id));
    return {
      id: t.id + ':' + cle + ':' + contour.id,
      cle,
      nom: nomLibre(th.noms, cle, nomsPris) + ' · ' + cap(d.nom || d.nomCourt),
      ambiance: th.label,
      theme: x.theme,
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
   * o.n         nombre de propositions (4 par défaut)
   * o.graine    graine du hasard ; o.alea dose de hasard ; o.exclure clés déjà montrées
   */
  function recommander(o) {
    o = o || {};
    if (!PALETTE.length) throw new Error('Palette non chargée : appeler charger(palette) avant.');
    const t = tressage(o.tressage || 'maille');
    const fam = norm(o.famille || 'aucune');
    const themes = THEMES[fam] ? [fam] : ORDRE_THEMES;
    let cands = [];
    themes.forEach(id => { cands = cands.concat(candidatsTheme(id, t)); });
    cands.sort((a, b) => b.score - a.score);
    // Les meilleures, avec au plus 8 idées par dominante et par ambiance pour laisser de la place à toutes
    const parDom = {}, top = [];
    for (const c of cands) {
      const k = c.theme + '|' + c.cols[0].id;
      if ((parDom[k] || 0) >= 8) continue;
      parDom[k] = (parDom[k] || 0) + 1; top.push(c);
      if (top.length >= 500) break;
    }
    const choix = selectionner(top, o.n || 4, rngDe(o.graine), o.alea === undefined ? 10 : o.alea, o.exclure);
    const nomsPris = new Set();
    return choix.map(x => finaliser(x, t, nomsPris));
  }

  // Avis rapide sur une configuration manuelle (dans l'ambiance qui lui va le mieux)
  function diagnostiquer(o) {
    const t = tressage(o.tressage);
    const cols = t.slots.map(s => couleur(o.couleurs[s]));
    if (cols.some(c => !c)) return { score: null, niveau: 'incomplet', conseils: ['Choisis toutes les couleurs du tressage.'] };
    let best = null;
    ORDRE_THEMES.forEach(id => { const r = noter(cols, THEMES[id], t); if (r && (!best || r.score > best.score)) best = { score: r.score, theme: id }; });
    if (!best) return { score: 40, niveau: 'a-revoir', conseils: ['Deux couleurs sont trop proches : le motif se lit mal.'] };
    return { score: Math.round(best.score), niveau: best.score >= 80 ? 'excellent' : best.score >= 65 ? 'bon' : 'a-revoir', ambiance: THEMES[best.theme].label, conseils: [] };
  }

  return {
    CONFIG, TRESSAGES, THEMES, ORDRE_THEMES,
    charger, configurer, couleur, recommander, diagnostiquer,
    contoursPour: (cols, themeId, n) => contoursPour(ids(cols), THEMES[themeId] || THEMES.brasserie, n),
    palette: () => PALETTE.slice(),
    outils: { analyser, dE, dL, dH, noter }
  };
});
