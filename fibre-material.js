/*
 * fibre-material.js
 * Rendu « fibre réelle » : demi-jonc PVC teinté masse, 5 x 1,5 mm, vernis brillant.
 * Chaque tressage est prévalidé dans le banc d'essai, puis ses réglages sont reportés ici.
 * Le motif vient du masque PNG (rouge / vert). Relief, rainures et passages sous la fibre
 * croisée sont calculés dans le shader. Le calibrage par îlot recale le motif sur Tradition.
 */

// Réglages validés par tressage (Romeo, octobre 2026). Un seul endroit à modifier.
//   weaveType : 0 = couleur = sens du brin (Sergé, Chevron), 1 = Damier (blocs de 4 brins, 4 couleurs),
//               2 = Natté (blocs de 3 brins : c1 bords horizontaux, c2 bords verticaux, c3 centre),
//               3 = Bourdon (bandes verticales c1 / c2, grains = courts passages de trame)
//   grid      : nombre de cases (brins) par tuile du masque
//   refUvMm   : échelle de référence, mm réels par unité UV sur la chaise de référence
//   rawShapes : chaises de référence, laissées en UV brutes ; les autres sont recalées dessus
const FIBRE_SETTINGS = {
  serge:  { weaveType:0, grid:[30,16], rough:0.93, relief:0.69, ao:0.32, env:0.65, pairs:1, refUvMm:[190,146.5], rawShapes:['tradition','harpe'] },
  damier: { weaveType:1, grid:[10,8],  rough:0.80, relief:0.76, ao:0.72, env:0.53, pairs:1, refUvMm:[51.1,40.4], rawShapes:['tradition'] },
  chevron:{ weaveType:0, grid:[12,6],  rough:0.72, relief:0.64, ao:0.42, env:1.11, pairs:1, refUvMm:[84.9,37.7], rawShapes:['tradition'] },
  natte:  { weaveType:2, grid:[8,6],   rough:0.93, relief:0.69, ao:0.32, env:0.65, pairs:1, refUvMm:[40.7,30.7], rawShapes:['tradition'] },
  // Bourdon : le masque PNG est une bande de 10 rangées, répétée 5 fois en hauteur sur une unité UV
  bourdon:{ weaveType:3, grid:[89,50], maskGrid:[89,10], rough:0.66, relief:0.89, ao:0.51, env:0.35, pairs:1, refUvMm:[457.3,250.1], rawShapes:['tradition'] },
  // Maille : brins dans toutes les directions. Le relief vient de la carte de fibre (fibreMap),
  // calculée depuis le masque. frontWrap : face avant raccordée à l'assise (prioritaire).
  // frontCenter : centre d'une croix, en UV de motif (ancien réglage, face avant centrée).
  maille: { weaveType:4, grid:[12.3,12.3], rough:0.86, relief:0.44, ao:0.34, env:1.08, pairs:1, refUvMm:[90.1,87.2], rawShapes:['tradition'],
            fibreMap:'textures/maille-fibremap.png', frontWrap:true, frontCenter:[0.2857,0.6223], frontPeriod:[0.5,0.5] },
};

const FIBRE_VERT = `
  attribute vec4 aUvXform;   // calibrage par îlot : échelle u, échelle v, décalage u, décalage v
  uniform float uCalib;      // 1 si prepareFibreGeometry() a posé aUvXform sur ce maillage
  uniform mat3 uMaskMatrix;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  uniform vec3 uLogoUp;      // haut de la chaise, dans le repère du maillage
  uniform vec3 uLogoBack;    // direction avant -> dossier, dans le repère du maillage
  varying vec3 vObjUp;
  varying vec3 vObjBack;
  void main(){
    vObjUp = normalize(mat3(modelMatrix) * uLogoUp);
    vObjBack = normalize(mat3(modelMatrix) * uLogoBack);
    vUv = (uMaskMatrix * vec3(mix(uv, uv * aUvXform.xy + aUvXform.zw, uCalib), 1.0)).xy;
    vec4 wp = modelMatrix * vec4(position,1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FIBRE_FRAG = `
  uniform sampler2D uMask;
  uniform vec2 uGrid;
  uniform vec3 uC1, uC2, uC3, uC4;
  uniform float uWeave;    // 0 = couleur = sens (Sergé, Chevron), 1 = Damier, 2 = Natté, 3 = Bourdon, 4 = Maille (carte de fibre)
  uniform vec2 uMaskGrid;  // cases du masque PNG (différent de uGrid quand le masque se répète, ex. Bourdon x5 en hauteur)
  uniform float uRough, uRelief, uAO, uEnv, uPlain, uPairs;
  uniform float uReferenceFlipY;
  uniform vec3 uKeyDir, uFillDir, uRimDir;
  uniform sampler2D uFibreMap;   // Maille : carte de fibre
  uniform sampler2D uLogo;       // filigrane Martingale (alpha)
  uniform float uLogoOn;         // 1 = filigrane tissé dans le tressage
  uniform vec4 uLogoTile;        // largeur et hauteur de tuile (UV calibrées), -, intensité
  uniform vec2 uLogoBox;         // largeur et hauteur du logo (UV calibrées)
  varying vec3 vObjUp;
  varying vec3 vObjBack;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  const float PI = 3.14159265;

  vec3 toLin(vec3 c){ return pow(max(c,0.0), vec3(2.2)); }
  vec3 toSRGB(vec3 c){ return pow(max(c,0.0), vec3(1.0/2.2)); }

  // Lit le masque du motif au centre de chaque case (mêmes coordonnées que le rendu actuel)
  // 1.0 = fibre verticale (famille rouge, C1), 0.0 = fibre horizontale (famille verte, C2)
  float fam(vec2 cell){
    vec2 c = mod(cell, uMaskGrid);
    vec3 m = texture2D(uMask, (c + 0.5) / uMaskGrid).rgb;
    return step(m.g, m.r);
  }

  // Sens du brin visible dans la case : 1 = vertical, 0 = horizontal
  // Sergé : donné par la famille du masque. Damier : blocs de 4 brins, disposition fixe de la tuile 10 x 8.
  // Natté : brin central des faisceaux (magenta dans le masque)
  float centre(vec2 cell){
    vec2 c = mod(cell, uMaskGrid);
    vec3 m = texture2D(uMask, (c + 0.5) / uMaskGrid).rgb;
    return step(0.5, m.r) * step(0.5, m.b);
  }

  float orient(vec2 cell){
    if(uWeave < 0.5) return fam(cell);
    if(uWeave > 2.5){
      // Bourdon : bandes de brins verticaux ; un grain isolé (couleur différente au-dessus et au-dessous)
      // est un court passage horizontal de la trame par-dessus la chaîne
      float f = fam(cell), a = fam(cell + vec2(0.0,1.0)), b = fam(cell - vec2(0.0,1.0));
      return (abs(f-a) > 0.5 && abs(f-b) > 0.5) ? 0.0 : 1.0;
    }
    vec2 c = mod(cell, uGrid);
    if(uWeave > 1.5){
      // Natté : tuile 8 x 6, faisceaux de 3 brins
      if(c.y >= 3.0) return c.x >= 5.0 ? 1.0 : 0.0;
      return (c.x >= 1.0 && c.x < 4.0) ? 1.0 : 0.0;
    }
    if(c.y >= 4.0) return (c.x >= 1.0 && c.x < 5.0) ? 1.0 : 0.0;
    return c.x >= 6.0 ? 1.0 : 0.0;
  }

  // Couleur d'un brin selon sa famille (1 = extérieur / rouge, 0 = intérieur / vert) et son sens
  // Natté : C1 = bords horizontaux, C2 = bords verticaux, C3 = brins centraux
  vec3 strandColor(float isRed, float isV, float isCentre){
    if(uWeave < 0.5) return mix(uC2, uC1, isV);
    if(uWeave < 1.5) return isV > 0.5 ? mix(uC1, uC2, isRed) : mix(uC3, uC4, isRed);
    if(uWeave > 2.5) return mix(uC2, uC1, isRed);
    if(isCentre > 0.5) return uC3;
    return isV > 0.5 ? uC2 : uC1;
  }

  float ggx(float ndh, float a){
    float a2 = a*a;
    float d = ndh*ndh*(a2-1.0)+1.0;
    return a2/(PI*d*d);
  }

  vec3 lightSpec(vec3 N, vec3 V, vec3 L, float a, float f0){
    vec3 H = normalize(L+V);
    float ndl = max(dot(N,L),0.0);
    float ldh = max(dot(L,H),0.0);
    float F = f0 + (1.0-f0)*pow(1.0-max(dot(V,H),0.0),5.0);
    return vec3(ggx(max(dot(N,H),0.0), a) * F * 0.25/max(ldh*ldh,0.08) * ndl);
  }

  vec3 studioEnv(vec3 R, float rough){
    float y = R.y;
    vec3 env = mix(vec3(0.10,0.10,0.11), vec3(0.34,0.34,0.34), smoothstep(-0.35,0.05,y));
    env = mix(env, vec3(0.52,0.52,0.51), smoothstep(0.05,0.80,y));
    // Grande boîte à lumière au-dessus, côté clé : fait naître la ligne de reflet
    float sb = dot(R, normalize(vec3(0.38,0.82,0.43)));
    float w = 0.985 - rough*0.22;
    env += vec3(3.4) * smoothstep(w-0.05-rough*0.25, w, sb) * (1.0 - clamp(rough*1.3,0.0,0.75));
    // Bande secondaire, plus douce, côté opposé
    float sb2 = dot(R, normalize(vec3(-0.62,0.55,0.55)));
    env += vec3(0.7) * smoothstep(0.90-rough*0.3, 0.97, sb2);
    return env;
  }

  void main(){
    vec3 N = normalize(vNormalW);
    if(!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);

    vec3 base = uC1;
    vec3 Np = N;
    float ao = 1.0;
    float detail = 1.0;

    if(uPlain < 0.5 && uWeave > 3.5){
      // ===== Maille : brins dans toutes les directions, lus dans la carte de fibre =====
      // carte : R,G = direction vers le centre du brin (u, v) ; B = position 0 bord .. 1 centre
      vec2 refUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uReferenceFlipY));
      vec3 mk = texture2D(uMask, refUv).rgb;
      vec4 fm = texture2D(uFibreMap, refUv);
      bool isR = mk.r > 0.5 && mk.g < 0.5 && mk.b < 0.5;
      bool isG = mk.g > 0.5 && mk.r < 0.5;
      bool isB = mk.b > 0.5 && mk.r < 0.5 && mk.g < 0.5;
      bool isM = mk.r > 0.5 && mk.b > 0.5;
      // C1 croix A, C2 fuseaux, C3 croix B, C4 grille droite
      base = isR ? uC1 : isG ? uC2 : isB ? uC3 : uC4;
      float layer = isM ? 1.0 : isG ? 0.6 : 0.0;   // grille et fuseaux passent sous les croix

      vec3 dp1 = dFdx(vWorldPos), dp2 = dFdy(vWorldPos);
      vec2 du1 = dFdx(refUv), du2 = dFdy(refUv);
      vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
      vec3 T = dp2p*du1.x + dp1p*du2.x;
      vec3 B = dp2p*du1.y + dp1p*du2.y;
      T -= N*dot(N,T); B -= N*dot(N,B);
      float lt = length(T), lb = length(B);
      T = lt > 1e-8 ? T/lt : vec3(0.0);
      B = lb > 1e-8 ? B/lb : vec3(0.0);

      vec2 fw = fwidth(refUv * uGrid);
      float foot = max(fw.x, fw.y);
      detail = 1.0 - smoothstep(0.16, 0.65, foot);

      const float HALF = 2.5;
      const float HGT = 1.5;
      const float RAD = (HALF*HALF + HGT*HGT) / (2.0*HGT);
      float x = clamp(fm.b, 0.0, 1.0);          // 1 au centre du brin
      float s = 1.0 - x;                        // 0 au centre, 1 au bord
      vec2 dc = fm.rg*2.0 - 1.0;
      float dl = length(dc);
      dc = dl > 0.05 ? dc/dl : vec2(0.0);
      float slope = clamp(HALF*s/RAD * uRelief, 0.0, 0.9);
      vec3 tilt = -(T*dc.x + B*dc.y) * slope;   // la normale penche vers l'extérieur du brin
      vec3 Nd = normalize(N*sqrt(max(1.0 - dot(tilt,tilt), 0.05)) + tilt);
      Np = normalize(mix(N, Nd, detail));

      float hProf = (sqrt(max(RAD*RAD - HALF*HALF*s*s, 0.0)) - (RAD-HGT)) / HGT;
      float aoProf = mix(1.0 - uAO*0.6, 1.0, smoothstep(0.0, 0.5, hProf));
      float aoLayer = 1.0 - uAO*0.28*layer;
      ao = mix(1.0 - uAO*0.14, aoProf*aoLayer, detail);
    } else
    if(uPlain < 0.5){
      vec2 refUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uReferenceFlipY));
      vec2 g = refUv * uGrid;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float isV = orient(cell);
      float isRed = fam(cell);
      float isCentre = uWeave > 1.5 ? centre(cell) : 0.0;
      base = strandColor(isRed, isV, isCentre);

      float across = mix(f.y, f.x, isV);
      float along  = mix(f.x, f.y, isV);
      vec2 stepAlong = mix(vec2(1.0,0.0), vec2(0.0,1.0), isV);
      float endPrev = step(0.5, abs(orient(cell - stepAlong) - isV));
      float endNext = step(0.5, abs(orient(cell + stepAlong) - isV));

      // Repère tangent à partir des dérivées écran (pas de tangentes dans le GLB)
      vec3 dp1 = dFdx(vWorldPos), dp2 = dFdy(vWorldPos);
      vec2 du1 = dFdx(refUv), du2 = dFdy(refUv);
      vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
      vec3 T = dp2p*du1.x + dp1p*du2.x;
      vec3 B = dp2p*du1.y + dp1p*du2.y;
      T -= N*dot(N,T); B -= N*dot(N,B);
      float lt = length(T), lb = length(B);
      T = lt > 1e-8 ? T/lt : vec3(0.0);
      B = lb > 1e-8 ? B/lb : vec3(0.0);
      vec3 Across = mix(B, T, isV);
      vec3 Along  = mix(T, B, isV);

      // Anticrénelage : on lisse le relief quand un brin fait moins de quelques pixels
      vec2 fw = fwidth(g);
      float foot = max(fw.x, fw.y);
      detail = 1.0 - smoothstep(0.16, 0.65, foot);

      // Profil réel : arc de cercle, 5 mm de corde, 1,5 mm de flèche
      const float HALF = 2.5;
      const float HGT = 1.5;
      const float RAD = (HALF*HALF + HGT*HGT) / (2.0*HGT);
      // Chaque case du motif = une paire de brins côte à côte (comme sur la chaise réelle)
      float xs = fract(across * uPairs);
      float x = clamp(xs*2.0 - 1.0, -1.0, 1.0);
      // Fin jour entre deux cases : on aperçoit la fibre croisée, dans l'ombre, dessous
      float gapEdge = min(across, 1.0 - across);
      float gap = (1.0 - smoothstep(0.0, 0.045, gapEdge)) * detail;
      vec3 under = uWeave > 2.5 ? mix(uC1, uC2, isRed) : strandColor(isRed, 1.0 - isV, 0.0);
      float sAcross = clamp(HALF*x/RAD * uRelief, -0.97, 0.97);
      float hProf = (sqrt(RAD*RAD - HALF*HALF*x*x) - (RAD-HGT)) / HGT;

      // Plongée sous la fibre croisée en bout de passe
      const float K = 0.24;
      float wPrev = endPrev * (1.0 - smoothstep(0.0, K, along));
      float wNext = endNext * (1.0 - smoothstep(0.0, K, 1.0 - along));
      float sAlong = (wNext*wNext - wPrev*wPrev) * 0.62 * uRelief;
      float dive = max(wPrev, wNext);

      vec3 tilt = Across*sAcross + Along*sAlong;
      float tl = length(tilt);
      if(tl > 0.9) tilt *= 0.9/tl;   // jamais de normale rasante : évite les points brillants aux coins
      vec3 Nd = normalize(N*sqrt(1.0 - dot(tilt,tilt)) + tilt);
      Np = normalize(mix(N, Nd, detail));

      float aoProf = mix(1.0 - uAO*0.55, 1.0, smoothstep(0.0, 0.55, hProf));
      float aoDive = 1.0 - uAO*0.5*pow(dive, 1.6);
      ao = mix(1.0 - uAO*0.14, aoProf*aoDive, detail);
      base = mix(base, under, gap*0.85);
      ao *= 1.0 - gap*0.72;
    }

    // Filigrane : le logo teinte les brins eux-mêmes (suit le relief et la lumière)
    if(uLogoOn > 0.5 && uPlain < 0.5){
      vec2 lu = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uReferenceFlipY));
      vec2 tile = uLogoTile.xy;
      float row = floor(lu.y / tile.y);
      vec2 q = vec2(lu.x / tile.x + row*0.5, lu.y / tile.y);
      vec2 d = (fract(q) - 0.5) * tile;                       // position dans la tuile, centrée
      vec2 box = uLogoBox;                                    // taille du logo en UV (texture 1024 x 256)
      // Sens de lecture : debout sur les faces verticales, lisible depuis l'avant sur l'assise,
      // jamais en miroir quel que soit le côté regardé
      vec3 lp1 = dFdx(vWorldPos), lp2 = dFdy(vWorldPos);
      vec2 lu1 = dFdx(lu), lu2 = dFdy(lu);
      vec3 lT = cross(lp2, N)*lu1.x + cross(N, lp1)*lu2.x;   // direction des u croissants
      vec3 lB = cross(lp2, N)*lu1.y + cross(N, lp1)*lu2.y;   // direction des v croissants
      vec3 up = normalize(vObjUp);
      vec3 want = abs(dot(N, up)) < 0.6 ? up : normalize(vObjBack);
      vec3 Nv = dot(N, V) < 0.0 ? -N : N;
      vec3 right = cross(want, Nv);
      vec2 p = d * vec2(dot(lT, right) < 0.0 ? -1.0 : 1.0, dot(lB, want) < 0.0 ? -1.0 : 1.0);
      vec2 luv = p / box + 0.5;
      float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
      float la = texture2D(uLogo, luv).a * inside;
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      vec3 ink = lum > 0.42 ? vec3(0.07, 0.07, 0.065) : vec3(0.95, 0.94, 0.91);   // noir sur brins clairs, blanc sur brins foncés : lisible sur toute capture
      base = mix(base, ink, la * uLogoTile.w);
    }

    // Matière : PVC teinté masse, vernis brillant
    float rough = mix(0.30, 0.05, uRough);
    rough = mix(max(rough, 0.32), rough, detail);   // évite le scintillement de loin
    float a = rough*rough;
    const float F0 = 0.045;
    vec3 alb = toLin(base);

    float ndv = max(dot(Np,V), 1e-4);
    vec3 sky = vec3(1.0,0.985,0.955), gnd = vec3(0.70,0.73,0.75);
    vec3 E = mix(gnd, sky, Np.y*0.5+0.5) * 0.46
           + vec3(1.0,0.955,0.875) * 0.66 * max(dot(Np,uKeyDir),0.0)
           + vec3(0.87,0.92,1.0) * 0.14 * max(dot(Np,uFillDir),0.0)
           + vec3(1.0) * 0.10 * max(dot(Np,uRimDir),0.0);

    float Fenv = F0 + (max(1.0-rough, F0) - F0) * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, Np);
    vec3 envSpec = studioEnv(R, rough) * Fenv * uEnv * mix(0.55, 1.0, detail);  // de loin, la teinte prime sur le vernis

    vec3 spec = lightSpec(Np,V,uKeyDir,a,F0) * vec3(1.0,0.955,0.875) * 0.66
              + lightSpec(Np,V,uFillDir,a,F0) * 0.14
              + lightSpec(Np,V,uRimDir,a,F0) * 0.10;

    vec3 col = alb * E * ao * (1.0 - Fenv);
    col += spec * mix(1.0, ao, 0.7);
    col += envSpec * mix(0.30, 1.0, ao);

    // Épaule douce pour les hautes lumières, puis retour sRGB
    vec3 over = max(col - 0.82, 0.0);
    col = min(col, 0.82) + 0.18*(1.0 - exp(-over/0.18));
    gl_FragColor = vec4(toSRGB(col), 1.0);
  }`;

/*
 * fibre-calibration.js
 * Calibrage automatique des UV du tressage, îlot par îlot (assise, face avant, dossier, côtés).
 * Chaque îlot est recalé sur l'îlot de même rôle de la chaise de référence (Tradition) :
 * même échelle réelle et même point d'ancrage du motif.
 * Un îlot déjà à moins de 8 % de l'échelle de référence est laissé tel quel (UV brutes).
 * Résultat : un attribut par sommet aUvXform = (échelle u, échelle v, décalage u, décalage v).
 */
(function(global){

  // seatZ : profondeur du centre de l'assise. La face avant est devant, le dossier derrière.
  function islandRole(n, c, seatZ){
    if(Math.abs(n[1]) >= 0.7) return 'seat';
    if(Math.abs(n[2]) >= 0.7 && c[2] > seatZ) return 'front';
    if(Math.abs(n[0]) >= 0.6) return n[0] > 0 ? 'sideR' : 'sideL';
    return 'back';
  }

  // Point d'ancrage physique de chaque rôle : le bord où le motif « démarre »
  function anchorScore(role, p, isl){
    const dx = Math.abs(p[0] - isl.centre[0]);
    switch(role){
      case 'seat':  return dx + (isl.max[2] - p[2]) * 3;   // milieu du bord avant de l'assise
      case 'front': return dx + (isl.max[1] - p[1]) * 3;   // milieu du haut de la face avant
      case 'back':  return dx + (p[1] - isl.min[1]) * 3;   // milieu du bas du dossier
      case 'sideR':
      case 'sideL': return (p[1] - isl.min[1]) * 3 + (isl.max[2] - p[2]);
    }
    return dx;
  }

  /*
   * pos : positions déjà exprimées dans le repère du GLB (mètres), tableau plat xyz
   * uv  : tableau plat uv ; idx : tableau d'indices (ou null)
   * Retourne la liste des îlots avec échelle (mm par unité UV), sens et ancrage.
   */
  function analyzeIslands(pos, uv, idx){
    const nv = pos.length / 3, nt = idx ? idx.length/3 : nv/3;
    const I = i => idx ? idx[i] : i;
    const par = new Int32Array(nv); for(let i=0;i<nv;i++) par[i]=i;
    const find = x => { while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
    const unite = (a,b) => { a=find(a); b=find(b); if(a!==b) par[b]=a; };
    for(let t=0;t<nt;t++){ unite(I(3*t),I(3*t+1)); unite(I(3*t),I(3*t+2)); }
    // Sommets dupliqués (même position, même UV) : même îlot
    const key = new Map();
    for(let v=0;v<nv;v++){
      const k = pos[3*v].toFixed(5)+','+pos[3*v+1].toFixed(5)+','+pos[3*v+2].toFixed(5)+'|'+uv[2*v].toFixed(5)+','+uv[2*v+1].toFixed(5);
      if(key.has(k)) unite(key.get(k), v); else key.set(k, v);
    }
    const isl = new Map();
    for(let t=0;t<nt;t++){
      const i0=I(3*t), i1=I(3*t+1), i2=I(3*t+2), r=find(i0);
      const ax=pos[3*i0],ay=pos[3*i0+1],az=pos[3*i0+2];
      const e1=[pos[3*i1]-ax,pos[3*i1+1]-ay,pos[3*i1+2]-az], e2=[pos[3*i2]-ax,pos[3*i2+1]-ay,pos[3*i2+2]-az];
      const du1=uv[2*i1]-uv[2*i0], dv1=uv[2*i1+1]-uv[2*i0+1], du2=uv[2*i2]-uv[2*i0], dv2=uv[2*i2+1]-uv[2*i0+1];
      const cr=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const area=Math.hypot(cr[0],cr[1],cr[2])/2;
      let o=isl.get(r);
      if(!o){ o={area:0,LU:[],LV:[],c:[0,0,0],n:[0,0,0],dU:[0,0,0],dV:[0,0,0],min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]}; isl.set(r,o); }
      o.area+=area;
      for(let k=0;k<3;k++){ o.c[k]+=(pos[3*i0+k]+pos[3*i1+k]+pos[3*i2+k])/3*area; o.n[k]+=cr[k]/2; }
      const det=du1*dv2-du2*dv1;
      if(Math.abs(det)>1e-12 && area>0){
        const T=[0,1,2].map(k=>(e1[k]*dv2-e2[k]*dv1)/det), B=[0,1,2].map(k=>(e2[k]*du1-e1[k]*du2)/det);
        const lt=Math.hypot(...T), lb=Math.hypot(...B);
        o.LU.push([lt,area]); o.LV.push([lb,area]);
        for(let k=0;k<3;k++){ o.dU[k]+=T[k]/lt*area; o.dV[k]+=B[k]/lb*area; }
      }
    }
    for(let v=0;v<nv;v++){ const o=isl.get(find(v)); if(!o) continue; for(let k=0;k<3;k++){ o.min[k]=Math.min(o.min[k],pos[3*v+k]); o.max[k]=Math.max(o.max[k],pos[3*v+k]); } }
    const median = a => { a.sort((x,y)=>x[0]-y[0]); const tot=a.reduce((s,x)=>s+x[1],0); let acc=0; for(const x of a){ acc+=x[1]; if(acc>=tot/2) return x[0]; } return 0; };
    const norm = v => { const l=Math.hypot(...v)||1; return v.map(x=>x/l); };
    const out=[];
    for(const [root,o] of isl){
      if(!o.LU.length) continue;
      const island={ root, area:o.area, centre:o.c.map(x=>x/o.area), normal:norm(o.n), dirU:norm(o.dU), dirV:norm(o.dV),
        mmU:median(o.LU)*1000, mmV:median(o.LV)*1000, min:o.min, max:o.max };
      out.push(island);
    }
    const seat = out.filter(x=>Math.abs(x.normal[1])>=0.7).sort((a,b)=>b.area-a.area)[0];
    const seatZ = seat ? seat.centre[2] : 0;
    for(const island of out) island.role = islandRole(island.normal, island.centre, seatZ);
    // Ancrage : sommet le plus proche du point de départ du motif
    const best = new Map();
    for(let v=0;v<nv;v++){
      const r=find(v); const island=out.find(x=>x.root===r); if(!island) continue;
      const s=anchorScore(island.role,[pos[3*v],pos[3*v+1],pos[3*v+2]],island);
      const b=best.get(r); if(!b || s<b.s) best.set(r,{s,v});
    }
    for(const island of out){ const b=best.get(island.root); island.anchorUv=[uv[2*b.v],uv[2*b.v+1]]; }
    out.sort((a,b)=>b.area-a.area);
    return { islands:out, vertexIsland:(v)=>find(v) };
  }

  // Îlot de référence du même rôle (le plus grand).
  // Face avant absente de la référence (elle fait partie de l'îlot de l'assise, ex. Bourdon sur Tradition) :
  // on prolonge l'assise. Même ancrage (milieu du bord avant), même sens horizontal,
  // et le motif continue vers le bas en passant l'arête.
  function refFor(role, reference){
    const direct = reference.filter(r=>r.role===role).sort((a,b)=>b.area-a.area)[0];
    if(direct) return direct;
    if(role === 'front'){
      const seat = reference.filter(r=>r.role==='seat').sort((a,b)=>b.area-a.area)[0];
      if(seat){
        const down = seat.dirV[2] >= 0 ? [0,-1,0] : [0,1,0];
        return Object.assign({}, seat, { role:'front', dirV: down });
      }
    }
    return null;
  }

  /*
   * Calcule la transformation UV de chaque îlot. Retourne un Float32Array (4 valeurs par sommet).
   * reference : îlots de la chaise de référence (ancrage du motif par rôle)
   * refMm     : échelle cible en mm par unité UV (celle de l'assise de référence)
   * Si l'assise de la chaise est déjà à l'échelle (écart < tolérance), toute la chaise reste en UV brutes,
   * sauf si force = true : chaque îlot est alors recalé (échelle et ancrage) même s'il est déjà à l'échelle.
   * Les chaises de référence d'un tressage (voir FIBRE_SETTINGS.rawShapes) ne passent jamais ici.
   */
  function computeUvXform(pos, uv, idx, reference, refMm, tolerance, force){
    tolerance = tolerance == null ? 0.08 : tolerance;
    const res = analyzeIslands(pos, uv, idx);
    const nv = pos.length/3, xf = new Float32Array(nv*4);
    for(let v=0;v<nv;v++) xf.set([1,1,0,0], v*4);
    const seat = res.islands.find(x=>x.role==='seat');
    const report = [];
    if(!seat || (!force && Math.abs(seat.mmU/refMm[0]-1) <= tolerance && Math.abs(seat.mmV/refMm[1]-1) <= tolerance)){
      return { xform:xf, report:[{role:'chaise', note:'déjà à l\'échelle, UV brutes'}], islands:res.islands, calibrated:false };
    }
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const byRoot = new Map();
    for(const island of res.islands){
      const ref = refFor(island.role, reference);
      let SU = island.mmU/refMm[0], SV = island.mmV/refMm[1];
      let t;
      if(ref){
        if(dot(island.dirU, ref.dirU) < 0) SU = -SU;
        if(dot(island.dirV, ref.dirV) < 0) SV = -SV;
        t = [SU, SV, ref.anchorUv[0] - island.anchorUv[0]*SU, ref.anchorUv[1] - island.anchorUv[1]*SV];
      } else {
        t = [SU, SV, island.anchorUv[0]*(1-SU), island.anchorUv[1]*(1-SV)];
      }
      byRoot.set(island.root, t);
      report.push({role:island.role, mm:[Math.round(island.mmU),Math.round(island.mmV)], xform:t.map(x=>+x.toFixed(4))});
    }
    for(let v=0;v<nv;v++){ const t=byRoot.get(res.vertexIsland(v)); if(t) xf.set(t, v*4); }
    return { xform:xf, report, islands:res.islands, calibrated:true };
  }

  /*
   * Centre le motif sur la face avant : le milieu de chaque îlot « face avant » (après calibrage)
   * est déplacé sur la cible (u, v) la plus proche, à une période de motif près.
   * S'applique à toutes les chaises, référence comprise.
   */
  function alignFrontIslands(pos, uv, idx, xf, target, period){
    const res = analyzeIslands(pos, uv, idx);
    const nv = pos.length/3;
    const fronts = new Set(res.islands.filter(i=>i.role==='front').map(i=>i.root));
    if(!fronts.size) return 0;
    const rng = new Map();
    for(let v=0; v<nv; v++){
      const r = res.vertexIsland(v); if(!fronts.has(r)) continue;
      const u2 = uv[2*v]*xf[4*v] + xf[4*v+2], v2 = uv[2*v+1]*xf[4*v+1] + xf[4*v+3];
      let o = rng.get(r); if(!o){ o=[1e9,-1e9,1e9,-1e9]; rng.set(r,o); }
      o[0]=Math.min(o[0],u2); o[1]=Math.max(o[1],u2); o[2]=Math.min(o[2],v2); o[3]=Math.max(o[3],v2);
    }
    const wrap = (x,p) => x - p*Math.round(x/p);
    const shift = new Map();
    for(const [r,o] of rng) shift.set(r, [wrap(target[0]-(o[0]+o[1])/2, period[0]), wrap(target[1]-(o[2]+o[3])/2, period[1])]);
    for(let v=0; v<nv; v++){
      const s = shift.get(res.vertexIsland(v)); if(!s) continue;
      xf[4*v+2] += s[0]; xf[4*v+3] += s[1];
    }
    return fronts.size;
  }


  /*
   * Raccorde la face avant à l'assise : le motif de l'assise passe l'arête et continue vers le bas,
   * comme un vrai tressage qui tourne autour du cadre. Même échelle et même position horizontale
   * que l'assise ; verticalement, le motif reprend là où l'assise s'arrête.
   * S'applique après le calibrage (xf contient déjà la transformation de l'assise).
   */
  function wrapFrontIslands(pos, uv, idx, xf, target, period){
    const res = analyzeIslands(pos, uv, idx);
    const nv = pos.length/3;
    const seat = res.islands.filter(i=>i.role==='seat').sort((a,b)=>b.area-a.area)[0];
    const fronts = res.islands.filter(i=>i.role==='front');
    if(!seat || !fronts.length) return 0;
    // Moindres carrés : f ≈ c0 + c1*a + c2*b
    const fit3 = (rows) => {
      const A=[[0,0,0],[0,0,0],[0,0,0]], B=[0,0,0];
      for(const [a,b,f] of rows){ const r=[1,a,b]; for(let i=0;i<3;i++){ B[i]+=r[i]*f; for(let j=0;j<3;j++) A[i][j]+=r[i]*r[j]; } }
      const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
      const D=det(A); if(Math.abs(D)<1e-18) return null;
      return [0,1,2].map(k=>det(A.map((row,i)=>row.map((x,j)=>j===k?B[i]:x)))/D);
    };
    const fit2 = (rows) => {
      let n=0,sa=0,sf=0,saa=0,saf=0;
      for(const [a,f] of rows){ n++; sa+=a; sf+=f; saa+=a*a; saf+=a*f; }
      const d=n*saa-sa*sa; if(Math.abs(d)<1e-18) return null;
      const k=(n*saf-sa*sf)/d; return [(sf-k*sa)/n, k];
    };
    const seatRoot = seat.root;
    const ru=[], rv=[], edgeY=[];
    const zs = seat.max[2];
    for(let v=0; v<nv; v++){
      if(res.vertexIsland(v)!==seatRoot) continue;
      const x=pos[3*v], y=pos[3*v+1], z=pos[3*v+2];
      ru.push([x, z, uv[2*v]*xf[4*v] + xf[4*v+2]]);
      rv.push([x, z, uv[2*v+1]*xf[4*v+1] + xf[4*v+3]]);
      if(z > zs - 0.015) edgeY.push(y);
    }
    const U = fit3(ru), V = fit3(rv);
    if(!U || !V || !edgeY.length) return 0;
    const ys = edgeY.reduce((s,y)=>s+y,0)/edgeY.length;
    let done = 0;
    for(const f of fronts){
      const fu=[], fv=[];
      for(let v=0; v<nv; v++){
        if(res.vertexIsland(v)!==f.root) continue;
        fu.push([pos[3*v], uv[2*v]]); fv.push([pos[3*v+1], uv[2*v+1]]);
      }
      const P = fit2(fu), Q = fit2(fv);
      if(!P || !Q || Math.abs(P[1])<1e-9 || Math.abs(Q[1])<1e-9) continue;
      const zf = f.centre[2], xc = f.centre[0];
      // Assise au bord avant : u = U0 + U1 x + U2 zs ; v continue en descendant (même pas que l'assise)
      const SU = U[1]/P[1], OU = U[0] + U[2]*zs - SU*P[0];
      const C  = V[0] + V[1]*xc + V[2]*zs + V[2]*Math.max(0, zf - zs) + V[2]*ys;
      const SV = -V[2]/Q[1], OV = C - SV*Q[0];
      for(let v=0; v<nv; v++){
        if(res.vertexIsland(v)!==f.root) continue;
        xf[4*v]=SU; xf[4*v+1]=SV; xf[4*v+2]=OU; xf[4*v+3]=OV;
      }
      done++;
    }
    // Recentrage : on décale ensemble l'assise et la face avant (le raccord reste continu)
    // pour qu'une rangée entière de motifs tombe au milieu de la face avant, sans motif coupé à l'arête.
    if(done && target && period){
      const big = fronts.slice().sort((a,b)=>b.area-a.area)[0];
      let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9;
      for(let v=0; v<nv; v++){
        if(res.vertexIsland(v)!==big.root) continue;
        const u2 = uv[2*v]*xf[4*v] + xf[4*v+2], v2 = uv[2*v+1]*xf[4*v+1] + xf[4*v+3];
        u0=Math.min(u0,u2); u1=Math.max(u1,u2); v0=Math.min(v0,v2); v1=Math.max(v1,v2);
      }
      const wrap = (x,p) => x - p*Math.round(x/p);
      const du = wrap(target[0]-(u0+u1)/2, period[0]), dv = wrap(target[1]-(v0+v1)/2, period[1]);
      const roots = new Set([seatRoot].concat(fronts.map(f=>f.root)));
      for(let v=0; v<nv; v++){
        if(!roots.has(res.vertexIsland(v))) continue;
        xf[4*v+2] += du; xf[4*v+3] += dv;
      }
    }
    return done;
  }

  global.FibreCalibration = { analyzeIslands, computeUvXform, alignFrontIslands, wrapFrontIslands };
})(typeof window !== 'undefined' ? window : globalThis);

// Îlots de la chaise de référence (Tradition), mesurés une fois : rôle, échelle, sens, ancrage du motif.
const FIBRE_REFERENCE = {
  serge: [{"role": "seat", "area": 0.19675, "mmU": 187.5, "mmV": 147.8, "dirU": [1, -0.003, 0], "dirV": [0, 0.007, 1], "anchorUv": [1.24148, 3.05386]}, {"role": "front", "area": 0.01661, "mmU": 187.7, "mmV": 118.2, "dirU": [1, 0, -0.001], "dirV": [0, -1, -0.019], "anchorUv": [1.24358, 3.06222]}, {"role": "back", "area": 0.0914, "mmU": 193.4, "mmV": 134.7, "dirU": [1, 0, 0.002], "dirV": [0, -0.969, 0.249], "anchorUv": [1.18923, 2.20736]}, {"role": "sideR", "area": 0.01064, "mmU": 243.6, "mmV": 152.6, "dirU": [-0.512, 0.033, -0.859], "dirV": [0.223, 0.973, -0.058], "anchorUv": [2.62724, 0.87386]}, {"role": "sideL", "area": 0.00666, "mmU": 245, "mmV": 134.1, "dirU": [0.266, -0.026, -0.964], "dirV": [-0.173, 0.979, -0.105], "anchorUv": [3.74441, 0.93761]}],
  damier: [{"role": "seat", "area": 0.19675, "mmU": 51.1, "mmV": 40.4, "dirU": [1, -0.004, 0], "dirV": [0, 0.005, 1], "anchorUv": [0.5622, 6.06762]}, {"role": "front", "area": 0.01661, "mmU": 50.9, "mmV": 40.2, "dirU": [1, 0, -0.001], "dirV": [0.001, -1, -0.019], "anchorUv": [0.5622, 2.02097]}, {"role": "back", "area": 0.0914, "mmU": 49.2, "mmV": 42.6, "dirU": [1, 0, 0.001], "dirV": [0, -0.969, 0.247], "anchorUv": [0.418, 3.09782]}, {"role": "sideR", "area": 0.01064, "mmU": 57.9, "mmV": 44.1, "dirU": [-0.542, 0.022, -0.84], "dirV": [0.201, 0.978, -0.062], "anchorUv": [5.29301, -1.30471]}, {"role": "sideL", "area": 0.00666, "mmU": 60.6, "mmV": 42.2, "dirU": [0.267, -0.026, -0.963], "dirV": [-0.179, 0.979, -0.103], "anchorUv": [7.11538, -1.22188]}],
  chevron: [{"role": "seat", "area": 0.19675, "mmU": 84.9, "mmV": 37.7, "dirU": [1, -0.001, 0], "dirV": [0, 0.006, 1], "anchorUv": [0.69996, 4.82454]}, {"role": "front", "area": 0.01661, "mmU": 84.9, "mmV": 38.6, "dirU": [1, 0, -0.001], "dirV": [0, -1, -0.019], "anchorUv": [0.69996, 4.82761]}, {"role": "back", "area": 0.0914, "mmU": 85.8, "mmV": 40.1, "dirU": [1, 0, 0.002], "dirV": [0, -0.969, 0.248], "anchorUv": [0.62932, 2.19228]}, {"role": "sideR", "area": 0.01064, "mmU": 101.6, "mmV": 41.6, "dirU": [-0.546, 0.023, -0.838], "dirV": [0.177, 0.983, -0.056], "anchorUv": [3.80831, -1.9358]}, {"role": "sideL", "area": 0.00666, "mmU": 105.2, "mmV": 40.3, "dirU": [0.267, -0.026, -0.963], "dirV": [-0.172, 0.979, -0.107], "anchorUv": [4.93554, -1.81601]}],
  natte: [{"role": "seat", "area": 0.19675, "mmU": 40.7, "mmV": 30.7, "dirU": [1, -0.005, 0], "dirV": [0, 0.003, 1], "anchorUv": [0.57819, 7.77049]}, {"role": "front", "area": 0.01661, "mmU": 40.8, "mmV": 31.1, "dirU": [1, 0, -0.001], "dirV": [0.001, -1, -0.019], "anchorUv": [0.57819, 1.79924]}, {"role": "back", "area": 0.0914, "mmU": 40, "mmV": 31.7, "dirU": [1, 0, 0.002], "dirV": [0, -0.969, 0.248], "anchorUv": [0.41794, 4.01495]}, {"role": "sideR", "area": 0.01064, "mmU": 48, "mmV": 32.7, "dirU": [-0.256, 0, -0.967], "dirV": [0.074, 0.997, 0], "anchorUv": [1.56063, -2.68791]}, {"role": "sideL", "area": 0.00666, "mmU": 43, "mmV": 30.6, "dirU": [0.268, -0.036, -0.963], "dirV": [-0.22, 0.972, -0.083], "anchorUv": [6.89434, -2.21063]}],
  bourdon: [{"role": "seat", "area": 0.21336, "mmU": 457.3, "mmV": 250.1, "dirU": [1, -0.001, 0], "dirV": [0, -0.086, 0.996], "anchorUv": [2.09518, 0.76861]}, {"role": "back", "area": 0.09806, "mmU": 458.9, "mmV": 260.3, "dirU": [0.998, 0.002, 0.06], "dirV": [0.017, -0.972, 0.233], "anchorUv": [2.06246, 0.98948]}, {"role": "sideR", "area": 0.01064, "mmU": 535, "mmV": 266.3, "dirU": [-0.533, 0.022, -0.846], "dirV": [0.194, 0.979, -0.063], "anchorUv": [2.61462, 0.28087]}, {"role": "sideL", "area": 2e-05, "mmU": 2192, "mmV": 307.5, "dirU": [0.335, -0.009, -0.942], "dirV": [0.03, -0.714, 0.699], "anchorUv": [1.85386, 1.02578]}],
  maille: [{"role":"seat","area":0.19675,"mmU":90.1,"mmV":87.2,"dirU":[1,-0.002,0],"dirV":[0,0.009,1],"anchorUv":[1.13684,2.16106]},{"role":"front","area":0.01661,"mmU":89.6,"mmV":90.3,"dirU":[1,0,0],"dirV":[0,-1,0],"anchorUv":[1.13953,6.65565]},{"role":"back","area":0.0914,"mmU":82.6,"mmV":86.9,"dirU":[1,0,-0.001],"dirV":[0,-0.969,0.249],"anchorUv":[0.94586,2.1234]},{"role":"sideR","area":0.01064,"mmU":97.8,"mmV":91.4,"dirU":[-0.499,0.024,-0.866],"dirV":[0.24,0.969,-0.059],"anchorUv":[4.45331,0.14374]},{"role":"sideL","area":0.00666,"mmU":101.4,"mmV":87.3,"dirU":[0.267,-0.028,-0.963],"dirV":[-0.175,0.979,-0.104],"anchorUv":[5.19299,0.1545]}],
};

// Copie du masque dédiée : filtrage au plus proche, sans anisotrope ni mipmaps,
// pour lire une case exacte (sinon des coutures apparaissent aux raccords d'UV).
const fibreMaskCache = {};
// Carte de fibre (Maille) : donnée, pas une couleur. Filtrage linéaire, sans conversion sRGB.
const fibreDataCache = {};
function getFibreDataTexture(uri){
  if(!fibreDataCache[uri]){
    const tex = new THREE.TextureLoader().load(uri, () => { if(typeof requestRender === 'function') requestRender(); });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if(THREE.LinearEncoding) tex.encoding = THREE.LinearEncoding;
    fibreDataCache[uri] = tex;
  }
  return fibreDataCache[uri];
}

function getFibreMaskTexture(uri){
  if(!fibreMaskCache[uri]){
    const tex = new THREE.TextureLoader().load(uri, () => { if(typeof requestRender === 'function') requestRender(); });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 1;
    fibreMaskCache[uri] = tex;
  }
  return fibreMaskCache[uri];
}

let fibreLogoTex = null;
function getFibreLogoTexture(){
  if(!fibreLogoTex){
    fibreLogoTex = new THREE.TextureLoader().load('textures/filigrane-martingale.png', () => { if(typeof requestRender === 'function') requestRender(); });
    fibreLogoTex.wrapS = fibreLogoTex.wrapT = THREE.ClampToEdgeWrapping;
    fibreLogoTex.anisotropy = 4;
  }
  return fibreLogoTex;
}
// Filigrane tissé : tailles en mm réels, converties en UV avec refUvMm de chaque tressage
const FIBRE_LOGO = { on: true, tileMm: [290, 135], logoMm: 235, strength: 1.0, pdfStrength: 1.0 };
function fibreLogoUniforms(cfg){
  const mm = cfg.refUvMm || [100, 100];
  const L = FIBRE_LOGO;
  return {
    tile: new THREE.Vector4(L.tileMm[0]/mm[0], L.tileMm[1]/mm[1], 0, L.strength),
    box: new THREE.Vector2(L.logoMm/mm[0], L.logoMm*0.25/mm[1]),
  };
}

function hasFibreMaterial(weaveId){ return !!FIBRE_SETTINGS[weaveId]; }

function fibreAttrGetter(attr){
  const arr = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
  const div = !attr.normalized ? 1 : arr instanceof Int16Array ? 32767 : arr instanceof Uint16Array ? 65535 : arr instanceof Int8Array ? 127 : arr instanceof Uint8Array ? 255 : 1;
  if(attr.isInterleavedBufferAttribute){ const d = attr.data; return (i,k)=>d.array[i*d.stride + attr.offset + k] / div; }
  return (i,k)=>arr[i*attr.itemSize + k] / div;
}

/*
 * Prépare le maillage du tressage : calcule et pose l'attribut aUvXform (calibrage par îlot).
 * root    : racine du modèle chargé (la mesure se fait dans les unités du GLB,
 *           la mise à l'échelle d'affichage du configurateur n'influe donc pas)
 * shapeId : structure affichée (tradition, harpe, resille, ogive)
 */
const fibreXformCache = new WeakMap();
function prepareFibreGeometry(mesh, root, weaveId, shapeId){
  const g = mesh.geometry, key = weaveId + '|' + shapeId;
  const cached = fibreXformCache.get(g);
  if(cached && cached.key === key){ if(cached.hook) mesh.onBeforeRender = cached.hook; return cached.res; }
  const P = g.attributes.position, U = g.attributes.uv, I = g.index;
  const cfg = FIBRE_SETTINGS[weaveId];
  const identity = () => { const a = new Float32Array(P.count*4); for(let i=0;i<P.count;i++) a.set([1,1,0,0], i*4); return a; };
  let res = null, xf, hook = null;
  try{
    if(!U) throw new Error('pas d\'UV');
    if(root) root.updateMatrixWorld(true); else mesh.updateMatrixWorld(true);
    const M = new THREE.Matrix4();
    if(root) M.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld); else M.copy(mesh.matrixWorld);
    // Filigrane : haut et sens avant -> dossier de la chaise, exprimés dans le repère du maillage
    const Mi = new THREE.Matrix4().copy(M).invert();
    const upL = new THREE.Vector3(0,1,0).transformDirection(Mi), backL = new THREE.Vector3(0,0,-1).transformDirection(Mi);
    hook = function(r, s, c, geo, mat){
      if(mat && mat.uniforms && mat.uniforms.uLogoUp){ mat.uniforms.uLogoUp.value.copy(upL); mat.uniforms.uLogoBack.value.copy(backL); }
    };
    mesh.onBeforeRender = hook;
    const gp = fibreAttrGetter(P), gu = fibreAttrGetter(U), v3 = new THREE.Vector3();
    const pos = new Float64Array(P.count*3), uv = new Float64Array(U.count*2);
    for(let i=0;i<P.count;i++){ v3.set(gp(i,0),gp(i,1),gp(i,2)).applyMatrix4(M); pos[3*i]=v3.x; pos[3*i+1]=v3.y; pos[3*i+2]=v3.z; uv[2*i]=gu(i,0); uv[2*i+1]=gu(i,1); }
    if((cfg.rawShapes || []).includes(shapeId)){
      xf = identity();   // chaise de référence : UV brutes
    } else {
      res = FibreCalibration.computeUvXform(pos, uv, I ? I.array : null, FIBRE_REFERENCE[weaveId] || [], cfg.refUvMm, 0.08, true);
      xf = res.xform;
    }
    // Face avant : frise centrée sur une rangée de motifs (toutes chaises, référence comprise)
    // Face avant raccordée à l'assise (le motif passe l'arête), sinon centrée sur une rangée de motifs
    if(cfg.frontWrap) FibreCalibration.wrapFrontIslands(pos, uv, I ? I.array : null, xf, cfg.frontWrapCenter || cfg.frontCenter, cfg.frontPeriod || [0.5,0.5]);
    else if(cfg.frontCenter) FibreCalibration.alignFrontIslands(pos, uv, I ? I.array : null, xf, cfg.frontCenter, cfg.frontPeriod || [0.5,0.5]);
  }catch(err){
    console.warn('Calibrage fibre impossible, UV brutes utilisées.', err);
    xf = identity();
  }
  g.setAttribute('aUvXform', new THREE.BufferAttribute(xf, 4));
  fibreXformCache.set(g, {key, res, hook});
  return res;
}

/*
 * weaveId    : 'serge', 'damier', 'chevron', 'natte', 'bourdon' ou 'maille'
 *              Maille : c1 croix A, c2 fuseaux, c3 croix B, c4 grille droite
 * maskUri    : chemin du masque du motif
 * colors     : couleurs hex. Sergé : c1 vertical, c2 horizontal.
 *              Damier : c1 vertical centre, c2 vertical bords, c3 horizontal centre, c4 horizontal bords
 * mappingTex : texture baked du GLB si présente (donne le cadrage UV et le sens), sinon null
 * calibrated : true si prepareFibreGeometry() a été appelé sur le maillage (sinon UV brutes,
 *              par exemple pour l'échantillon plat du PDF)
 */
function makeFibreMat(weaveId, maskUri, c1hex, c2hex, c3hex, c4hex, mappingTex, calibrated){
  const cfg = FIBRE_SETTINGS[weaveId];
  const mask = getFibreMaskTexture(maskUri);
  const ref = mappingTex && mappingTex.isTexture ? mappingTex : mask;
  if(ref.matrixAutoUpdate) ref.updateMatrix();
  return new THREE.ShaderMaterial({
    uniforms:{
      uMask:{value:mask},
      uMaskMatrix:{value:ref.matrix.clone()},
      uReferenceFlipY:{value: ref.flipY === mask.flipY ? 0 : 1},
      uGrid:{value:new THREE.Vector2(cfg.grid[0], cfg.grid[1])},
      uWeave:{value:cfg.weaveType},
      uMaskGrid:{value:new THREE.Vector2((cfg.maskGrid||cfg.grid)[0], (cfg.maskGrid||cfg.grid)[1])},
      uFibreMap:{value: cfg.fibreMap ? getFibreDataTexture(cfg.fibreMap) : mask},
      uC1:{value:hexToVec3(c1hex)}, uC2:{value:hexToVec3(c2hex)},
      uC3:{value:hexToVec3(c3hex || c1hex)}, uC4:{value:hexToVec3(c4hex || c2hex)},
      uRough:{value:cfg.rough}, uRelief:{value:cfg.relief}, uAO:{value:cfg.ao}, uEnv:{value:cfg.env},
      uPairs:{value:cfg.pairs}, uPlain:{value:0}, uCalib:{value: calibrated ? 1 : 0},
      uLogo:{value:getFibreLogoTexture()}, uLogoOn:{value: FIBRE_LOGO.on ? 1 : 0},
      uLogoTile:{value:fibreLogoUniforms(cfg).tile}, uLogoBox:{value:fibreLogoUniforms(cfg).box},
      uLogoUp:{value:new THREE.Vector3(0,1,0)}, uLogoBack:{value:new THREE.Vector3(0,0,-1)},
      // Mêmes directions que les lumières de la scène (clé, remplissage, contre-jour)
      uKeyDir:{value:new THREE.Vector3(3.4,5.6,3.6).normalize()},
      uFillDir:{value:new THREE.Vector3(-3.5,2.4,2.8).normalize()},
      uRimDir:{value:new THREE.Vector3(-1.4,3.1,-3.2).normalize()},
    },
    vertexShader:FIBRE_VERT,
    fragmentShader:FIBRE_FRAG,
    side:THREE.DoubleSide,
    extensions:{derivatives:true},
  });
}
