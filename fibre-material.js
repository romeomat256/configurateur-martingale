/*
 * fibre-material.js
 * Rendu « fibre réelle » : demi-jonc PVC teinté masse, 5 x 1,5 mm, vernis brillant.
 * Validé sur le banc d'essai Sergé (octobre 2026).
 * Le motif vient du masque PNG (rouge = fibre verticale C1, vert = fibre horizontale C2).
 * Le relief, les rainures et les passages sous la fibre croisée sont calculés dans le shader.
 */

// Réglages validés par tressage. Un seul endroit à modifier pour ajuster le rendu.
const FIBRE_SETTINGS = {
  // refUvMm : échelle de référence = UV brutes de Tradition et Harpe (validé par Romeo).
  // Les autres structures sont recalées dessus : le motif a la même taille sur toutes les chaises.
  serge: { grid:[30,16], rough:0.93, relief:0.69, ao:0.32, env:0.65, pairs:1, refUvMm:[190,146.5] },
};

const FIBRE_VERT = `
  uniform mat3 uMaskMatrix;
  attribute vec4 aUvXform;   // calibrage par îlot : échelle u, échelle v, décalage u, décalage v
  uniform float uCalib;      // 1 si prepareFibreGeometry() a posé aUvXform sur ce maillage
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main(){
    vUv = (uMaskMatrix * vec3(mix(uv, uv * aUvXform.xy + aUvXform.zw, uCalib), 1.0)).xy;
    vec4 wp = modelMatrix * vec4(position,1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FIBRE_FRAG = `
  uniform sampler2D uMask;
  uniform vec2 uGrid;
  uniform vec3 uC1, uC2;
  uniform float uRough, uRelief, uAO, uEnv, uPlain, uPairs;
  uniform vec3 uKeyDir, uFillDir, uRimDir;
  uniform float uReferenceFlipY;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  const float PI = 3.14159265;

  vec3 toLin(vec3 c){ return pow(max(c,0.0), vec3(2.2)); }
  vec3 toSRGB(vec3 c){ return pow(max(c,0.0), vec3(1.0/2.2)); }

  // Lit le masque du motif au centre de chaque case (mêmes coordonnées que le rendu actuel)
  // 1.0 = fibre verticale (famille rouge, C1), 0.0 = fibre horizontale (famille verte, C2)
  float fam(vec2 cell){
    vec2 c = mod(cell, uGrid);
    vec3 m = texture2D(uMask, (c + 0.5) / uGrid).rgb;
    return step(m.g, m.r);
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

    if(uPlain < 0.5){
      vec2 refUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uReferenceFlipY));
      vec2 g = refUv * uGrid;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float isV = step(0.5, fam(cell));
      base = mix(uC2, uC1, isV);

      float across = mix(f.y, f.x, isV);
      float along  = mix(f.x, f.y, isV);
      vec2 stepAlong = mix(vec2(1.0,0.0), vec2(0.0,1.0), isV);
      float endPrev = step(0.5, abs(step(0.5,fam(cell - stepAlong)) - isV));
      float endNext = step(0.5, abs(step(0.5,fam(cell + stepAlong)) - isV));

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
      vec3 under = mix(uC1, uC2, isV);
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

// Copie du masque dédiée : filtrage au plus proche, sans anisotrope ni mipmaps,
// pour lire une case exacte (sinon des coutures apparaissent aux raccords d'UV).
const fibreMaskCache = {};
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

function hasFibreMaterial(weaveId){ return !!FIBRE_SETTINGS[weaveId]; }

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

  // Îlot de référence du même rôle (le plus grand)
  function refFor(role, reference){
    return reference.filter(r=>r.role===role).sort((a,b)=>b.area-a.area)[0] || null;
  }

  /*
   * Calcule la transformation UV de chaque îlot. Retourne un Float32Array (4 valeurs par sommet).
   * reference : îlots de la chaise de référence (ancrage du motif par rôle)
   * refMm     : échelle cible en mm par unité UV (celle de l'assise de référence)
   * Si l'assise de la chaise est déjà à l'échelle (écart < tolérance), toute la chaise reste en UV brutes.
   */
  function computeUvXform(pos, uv, idx, reference, refMm, tolerance){
    tolerance = tolerance == null ? 0.08 : tolerance;
    const res = analyzeIslands(pos, uv, idx);
    const nv = pos.length/3, xf = new Float32Array(nv*4);
    for(let v=0;v<nv;v++) xf.set([1,1,0,0], v*4);
    const seat = res.islands.find(x=>x.role==='seat');
    const report = [];
    if(!seat || (Math.abs(seat.mmU/refMm[0]-1) <= tolerance && Math.abs(seat.mmV/refMm[1]-1) <= tolerance)){
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

  global.FibreCalibration = { analyzeIslands, computeUvXform };
})(typeof window !== 'undefined' ? window : globalThis);

// Îlots de la chaise de référence (Tradition), mesurés une fois : rôle, échelle, sens, ancrage du motif.
const FIBRE_REFERENCE = {
  serge: [{"role":"seat","area":0.19675,"mmU":187.5,"mmV":147.8,"dirU":[1,-0.003,0],"dirV":[0,0.007,1],"anchorUv":[1.24148,3.05386]},{"role":"front","area":0.01661,"mmU":187.7,"mmV":118.2,"dirU":[1,0,-0.001],"dirV":[0,-1,-0.019],"anchorUv":[1.24358,3.06222]},{"role":"back","area":0.0914,"mmU":193.4,"mmV":134.7,"dirU":[1,0,0.002],"dirV":[0,-0.969,0.249],"anchorUv":[1.18923,2.20736]},{"role":"sideR","area":0.01064,"mmU":243.6,"mmV":152.6,"dirU":[-0.512,0.033,-0.859],"dirV":[0.223,0.973,-0.058],"anchorUv":[2.62724,0.87386]},{"role":"sideL","area":0.00666,"mmU":245,"mmV":134.1,"dirU":[0.266,-0.026,-0.964],"dirV":[-0.173,0.979,-0.105],"anchorUv":[3.74441,0.93761]}],
};

/*
 * Prépare le maillage du tressage : calcule et pose l'attribut aUvXform (calibrage par îlot).
 * root : racine du modèle chargé. La mesure se fait dans les unités du GLB,
 * donc la mise à l'échelle d'affichage du configurateur n'influe pas.
 */
const fibreXformCache = new WeakMap();
function fibreAttrGetter(attr){
  const arr = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
  const div = !attr.normalized ? 1 : arr instanceof Int16Array ? 32767 : arr instanceof Uint16Array ? 65535 : arr instanceof Int8Array ? 127 : arr instanceof Uint8Array ? 255 : 1;
  if(attr.isInterleavedBufferAttribute){ const d = attr.data; return (i,k)=>d.array[i*d.stride + attr.offset + k] / div; }
  return (i,k)=>arr[i*attr.itemSize + k] / div;
}
function prepareFibreGeometry(mesh, root, weaveId){
  const g = mesh.geometry;
  const key = weaveId;
  const cached = fibreXformCache.get(g);
  if(cached && cached.key === key){ return cached.res; }
  const P = g.attributes.position, U = g.attributes.uv, I = g.index;
  const identity = () => { const a = new Float32Array(P.count*4); for(let i=0;i<P.count;i++) a.set([1,1,0,0], i*4); return a; };
  let res = null, xf;
  try{
    if(!U) throw new Error('pas d\'UV');
    if(root) root.updateMatrixWorld(true); else mesh.updateMatrixWorld(true);
    const M = new THREE.Matrix4();
    if(root) M.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld); else M.copy(mesh.matrixWorld);
    const gp = fibreAttrGetter(P), gu = fibreAttrGetter(U), v3 = new THREE.Vector3();
    const pos = new Float64Array(P.count*3), uv = new Float64Array(U.count*2);
    for(let i=0;i<P.count;i++){ v3.set(gp(i,0),gp(i,1),gp(i,2)).applyMatrix4(M); pos[3*i]=v3.x; pos[3*i+1]=v3.y; pos[3*i+2]=v3.z; uv[2*i]=gu(i,0); uv[2*i+1]=gu(i,1); }
    const cfg = FIBRE_SETTINGS[weaveId];
    res = FibreCalibration.computeUvXform(pos, uv, I ? I.array : null, FIBRE_REFERENCE[weaveId] || [], cfg.refUvMm);
    xf = res.xform;
  }catch(err){
    console.warn('Calibrage fibre impossible, UV brutes utilisées.', err);
    xf = identity();
  }
  g.setAttribute('aUvXform', new THREE.BufferAttribute(xf, 4));
  fibreXformCache.set(g, {key, res});
  return res;
}

/*
 * weaveId    : 'serge' (seul tressage branché pour l'instant)
 * maskUri    : chemin du masque du motif
 * mappingTex : texture baked du GLB si présente (donne le cadrage UV et le sens), sinon null
 * calibrated : true si prepareFibreGeometry() a été appelé sur le maillage (sinon UV brutes,
 *              par exemple pour l'échantillon plat du PDF)
 */
function makeFibreMat(weaveId, maskUri, c1hex, c2hex, mappingTex, calibrated){
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
      uC1:{value:hexToVec3(c1hex)}, uC2:{value:hexToVec3(c2hex)},
      uRough:{value:cfg.rough}, uRelief:{value:cfg.relief}, uAO:{value:cfg.ao}, uEnv:{value:cfg.env},
      uPairs:{value:cfg.pairs}, uPlain:{value:0}, uCalib:{value: calibrated ? 1 : 0},
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
