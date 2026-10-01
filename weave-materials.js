// Shared shader source. Keep texture-specific mapping and lighting equations unchanged.
const WEAVE_GLSL={vertexMappedCompact: "\n      uniform mat3 uMaskMatrix;\n      varying vec2 vUv;\n      varying vec3 vNormalW, vViewDirW;\n      void main(){\n        vUv=(uMaskMatrix*vec3(uv,1.0)).xy;\n        vec4 worldPos=modelMatrix*vec4(position,1.0);\n        vNormalW=normalize(mat3(modelMatrix)*normal);\n        vViewDirW=normalize(cameraPosition-worldPos.xyz);\n        gl_Position=projectionMatrix*viewMatrix*worldPos;\n      }\n    ",
vertexMappedFlipped: "\n      uniform mat3 uMaskMatrix;\n      uniform float uReferenceFlipY;\n      varying vec2 vUv;\n      varying vec3 vNormalW;\n      varying vec3 vViewDirW;\n      void main() {\n        vUv = (uMaskMatrix * vec3(uv,1.0)).xy;\n        vUv.y=mix(vUv.y,1.0-vUv.y,uReferenceFlipY);\n        vec4 worldPos = modelMatrix * vec4(position, 1.0);\n        vNormalW = normalize(mat3(modelMatrix) * normal);\n        vViewDirW = normalize(cameraPosition - worldPos.xyz);\n        gl_Position = projectionMatrix * viewMatrix * worldPos;\n      }\n    ",
vertexUv: "\n      varying vec2 vUv;\n      varying vec3 vNormalW;\n      varying vec3 vViewDirW;\n      void main() {\n        vUv = uv;\n        vec4 worldPos = modelMatrix * vec4(position, 1.0);\n        vNormalW = normalize(mat3(modelMatrix) * normal);\n        vViewDirW = normalize(cameraPosition - worldPos.xyz);\n        gl_Position = projectionMatrix * viewMatrix * worldPos;\n      }\n    ",
vertexMapped: "\n      uniform mat3 uMaskMatrix;\n      varying vec2 vUv;\n      varying vec3 vNormalW;\n      varying vec3 vViewDirW;\n      void main() {\n        vUv = (uMaskMatrix * vec3(uv, 1.0)).xy;\n        vec4 worldPos = modelMatrix * vec4(position, 1.0);\n        vNormalW = normalize(mat3(modelMatrix) * normal);\n        vViewDirW = normalize(cameraPosition - worldPos.xyz);\n        gl_Position = projectionMatrix * viewMatrix * worldPos;\n      }\n    ",
sameFamily: "float sameFamily(vec2 uv, float id) {\n        float other = familyId(texture2D(uTex, uv).rgb);\n        return 1.0 - step(0.25, abs(other - id));\n      }",
bourdonReferenceFamily: "float referenceFamily(vec3 c) {\n        return smoothstep(0.40,0.65,(c.r-max(c.g,c.b))/max(c.r,0.001));\n      }",
bourdonReferenceRelief: "float referenceRelief(vec3 c) {\n        float red=referenceFamily(c);\n        return mix(smoothstep(0.64,0.76,c.r),smoothstep(0.47,0.57,c.r),red);\n      }"
};
function createWeaveMaterial(options){return new THREE.ShaderMaterial({side:THREE.DoubleSide,...options});}
function hexToVec3(hex){return new THREE.Vector3(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);}
function makeSergeMaskShadeMat(maskTex, shadeTex, c1hex, c2hex, mappingTex=maskTex) {
  if(!mappingTex?.isTexture) mappingTex=maskTex;
  if(mappingTex.matrixAutoUpdate) mappingTex.updateMatrix();

  return createWeaveMaterial({
    uniforms:{
      uMask:{value:maskTex}, uShade:{value:shadeTex},
      uC1:{value:hexToVec3(c1hex)}, uC2:{value:hexToVec3(c2hex)},
      uMaskMatrix:{value:mappingTex.matrix.clone()},
      uReferenceFlipY:{value:mappingTex.flipY===maskTex.flipY?0:1},
    },
    vertexShader: WEAVE_GLSL.vertexMappedCompact,
    fragmentShader:`
      uniform sampler2D uMask, uShade;
      uniform vec3 uC1, uC2;
      uniform float uReferenceFlipY;
      varying vec2 vUv;
      varying vec3 vNormalW, vViewDirW;
      void main(){
        vec2 refUv=vec2(vUv.x,mix(vUv.y,1.0-vUv.y,uReferenceFlipY));
        vec3 mask=texture2D(uMask,refUv).rgb;
        vec3 shade=texture2D(uShade,refUv).rgb;
        float separator=smoothstep(0.08,0.55,mask.b-max(mask.r,mask.g)*0.5);
        // C1 remains the red family and C2 the green family, as in the GLB.
        float green=step(mask.r,mask.g);
        vec3 base=mix(uC1,uC2,green);
        // Normalize the charcoal/copper reference independently, so neither
        // reference colour is baked into the user's palette.
        float value=max(shade.r,max(shade.g,shade.b));
        float volume=clamp((value-mix(0.07,0.24,green))/mix(0.24,0.46,green),0.0,1.0);
        // Maille's satin response, driven by the Sergé reference relief.
        float fibreVolume=smoothstep(0.0,1.0,volume);
        float fibreShade=mix(0.74,1.16,fibreVolume);
        float groove=(1.0-fibreVolume)*0.2;
        float satin=fibreVolume*0.34;
        vec3 N=normalize(vNormalW);
        if(!gl_FrontFacing) N=-N;
        vec3 V=normalize(vViewDirW);
        vec3 L=normalize(vec3(-0.18,0.82,0.48));
        float diffuse=0.94+max(dot(N,L),0.0)*0.08;
        float spec=pow(max(dot(N,normalize(L+V)),0.0),42.0)*(0.06+satin*0.1);
        float rim=pow(1.0-max(dot(N,V),0.0),2.35)*0.04;
        vec3 shaded=base*fibreShade*diffuse;
        shaded*=mix(1.0,0.88,groove);
        vec3 col=mix(base,shaded,0.58);
        float baseLum=dot(base,vec3(0.299,0.587,0.114));
        float dark=1.0-smoothstep(0.02,0.36,baseLum);
        float darkCrest=smoothstep(0.26,0.9,fibreVolume)*dark;
        col=max(col-vec3((1.0-fibreVolume)*dark*0.035),vec3(0.0));
        col+=vec3(darkCrest*0.18);
        float light=smoothstep(0.68,0.96,baseLum);
        col=max(col-vec3((1.0-fibreVolume)*light*0.16),vec3(0.0));
        // Preserve the mask's exact blue seams; never widen or rotate fibres.
        float separatorLum=smoothstep(0.12,0.84,baseLum);
        vec3 separatorCol=base*mix(0.56,0.24,separatorLum);
        separatorCol+=vec3((1.0-separatorLum)*0.08);
        col=mix(col,separatorCol,separator*0.78);
        col=mix(col,vec3(1.0),(spec+rim+satin*0.018)*(1.0-separator));
        gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
      }
    `, transparent:false, depthWrite:true,
  });
}

function makeDamierMaskShadeMat(maskTex, shadeTex, c1hex, c2hex, c3hex, c4hex, mappingTex=maskTex) {
  if(mappingTex.matrixAutoUpdate) mappingTex.updateMatrix();
  
  return createWeaveMaterial({
    uniforms: {
      uMaskMatrix: {value:mappingTex.matrix.clone()},
      uReferenceFlipY: {value:mappingTex.flipY===maskTex.flipY?0:1},
      uMask:  { value: maskTex },
      uShade: { value: shadeTex },
      uC1:    { value: hexToVec3(c1hex) },
      uC2:    { value: hexToVec3(c2hex) },
      uC3:    { value: hexToVec3(c3hex) },
      uC4:    { value: hexToVec3(c4hex || c3hex) },
    },
    vertexShader: WEAVE_GLSL.vertexMappedFlipped,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uShade;
      uniform vec3 uC1, uC2, uC3, uC4;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      void main() {
        vec3 mask = texture2D(uMask, vUv).rgb;
        vec3 src = texture2D(uShade, vUv).rgb;
        float lum = dot(src, vec3(0.299, 0.587, 0.114));
        float hi = max(max(src.r, src.g), src.b);
        float lo = min(min(src.r, src.g), src.b);
        float contrast = clamp((hi - lo) * 1.55, 0.0, 1.0);

        // Motif 4: two pigment families, each crossing in both directions.
        // The reference is sampled with flipY; top half is texture y > 0.5.
        vec2 tile=fract(vUv);
        bool vertical=tile.y>0.5 ? (tile.x>=0.103 && tile.x<0.500)
                                      : (tile.x>=0.603);
        bool green=mask.g>mask.r;
        vec3 baseCol=green ? (vertical ? uC1 : uC3)
                           : (vertical ? uC2 : uC4);
        float blueLine=smoothstep(0.1,0.7,mask.b-max(mask.r,mask.g));
        // Normalize the black and white reference independently.
        float fibreVolume=green ? smoothstep(0.45,0.99,hi)
                                : smoothstep(0.02,0.42,hi);

        float bandCore = smoothstep(0.28, 0.88, fibreVolume);
        float groove = (1.0 - fibreVolume) * (0.18 + contrast * 0.08) + blueLine * 0.22;
        float crest = pow(bandCore, 1.6);
        float satin = crest * 0.30 + contrast * 0.05;

        vec3 N = normalize(vNormalW);
        if(!gl_FrontFacing) N=-N;
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.22, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.93 + ndl * 0.10;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.045 + satin * 0.12);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.25) * 0.035;

        vec3 col = baseCol * mix(0.72, 1.17, fibreVolume) * diff;
        col *= mix(1.0, 0.84, groove);

        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkFactor = (1.0 - smoothstep(0.02, 0.34, baseLum));
        col += vec3(darkFactor * crest * 0.18);

        float lightFactor = smoothstep(0.70, 0.98, baseLum);
        col = max(col - vec3(lightFactor * groove * 0.18), vec3(0.0));

        col = mix(baseCol, col, 0.70);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.010);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,});
}

function makeNatteMaskShadeMat(maskTex, shadeTex, c1hex, c2hex, c3hex) {
  
  return createWeaveMaterial({
    uniforms: {
      uMask:  { value: maskTex },
      uShade: { value: shadeTex },
      uC1:    { value: hexToVec3(c1hex) },
      uC2:    { value: hexToVec3(c2hex) },
      uC3:    { value: hexToVec3(c3hex) },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uShade;
      uniform vec3 uC1, uC2, uC3;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      void main() {
        vec3 mask = texture2D(uMask, vUv).rgb;
        vec3 src = texture2D(uShade, vUv).rgb;
        float lum = dot(src, vec3(0.299, 0.587, 0.114));
        float hi = max(max(src.r, src.g), src.b);
        float lo = min(min(src.r, src.g), src.b);
        float contrast = clamp((hi - lo) * 1.45, 0.0, 1.0);

        // Rouge, vert et magenta ne sont que des zones internes pour les 3 fibres nattées.
        float magentaScore = min(mask.r, mask.b) - mask.g * 0.45;
        float magentaMask = smoothstep(0.12, 0.46, magentaScore);
        float redScore = mask.r - max(mask.g, mask.b) * 0.58;
        float greenScore = mask.g - max(mask.r, mask.b) * 0.58;
        float redMask = smoothstep(0.08, 0.42, redScore) * (1.0 - magentaMask);
        float greenMask = smoothstep(0.08, 0.42, greenScore) * (1.0 - magentaMask);
        float blueLine = smoothstep(0.12, 0.70, mask.b - max(mask.r, mask.g) * 0.42) * (1.0 - magentaMask);
        float total = max(redMask + greenMask + magentaMask, 0.0001);

        vec3 baseCol = (uC1 * redMask + uC2 * greenMask + uC3 * magentaMask) / total;

        float broadVolume = smoothstep(0.08, 0.76, lum + contrast * 0.07);
        float highlight = smoothstep(0.54, 0.94, lum + contrast * 0.04);
        float shadow = smoothstep(0.36, 0.02, lum - contrast * 0.04);
        float fibreVolume = clamp(broadVolume * 0.88 + highlight * 0.12, 0.0, 1.0);

        float bandCore = smoothstep(0.22, 0.90, fibreVolume);
        float groove = shadow * (0.18 + contrast * 0.10) + blueLine * 0.20;
        float crest = pow(bandCore, 1.55);
        float satin = crest * 0.28 + contrast * 0.045;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.22, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.93 + ndl * 0.10;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.045 + satin * 0.12);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.25) * 0.035;

        vec3 col = baseCol * mix(0.72, 1.17, fibreVolume) * diff;
        col *= mix(1.0, 0.84, groove);

        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkFactor = smoothstep(0.34, 0.02, baseLum);
        col += vec3(darkFactor * crest * 0.18);

        float lightFactor = smoothstep(0.70, 0.98, baseLum);
        col = max(col - vec3(lightFactor * groove * 0.16), vec3(0.0));

        col = mix(baseCol, col, 0.70);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.010);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,});
}

function makeMaskShadeSwapMat(maskTex, shadeTex, c1hex, c2hex, c3hex, c4hex) {
  
  const maskImg = maskTex?.image;
  const maskTexel = new THREE.Vector2(
    1 / (maskImg?.naturalWidth || maskImg?.width || 4096),
    1 / (maskImg?.naturalHeight || maskImg?.height || 4096)
  );
  return createWeaveMaterial({
    uniforms: {
      uMask:  { value: maskTex },
      uShade: { value: shadeTex },
      uC1:    { value: hexToVec3(c1hex) },
      uC2:    { value: hexToVec3(c2hex) },
      uC3:    { value: hexToVec3(c3hex) },
      uC4:    { value: hexToVec3(c4hex || c3hex) },
      uMaskTexel: { value: maskTexel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uShade;
      uniform vec2 uMaskTexel;
      uniform vec3 uC1, uC2, uC3, uC4;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      float greenSignal(vec3 c) {
        return smoothstep(0.08, 0.42, c.g - max(c.r, c.b) * 0.55);
      }

      float whiteSignal(vec3 c) {
        float minChannel = min(min(c.r, c.g), c.b);
        float maxChannel = max(max(c.r, c.g), c.b);
        float chroma = maxChannel - minChannel;
        return smoothstep(0.64, 0.92, minChannel) * (1.0 - smoothstep(0.05, 0.20, chroma));
      }

      float greenDoubleFiberSeparator(vec2 uv, vec3 centerMask) {
        float whiteLine = whiteSignal(centerMask);
        vec2 dx = vec2(uMaskTexel.x * 2.25, 0.0);
        vec2 dy = vec2(0.0, uMaskTexel.y * 2.25);
        float sideGreenH = min(
          greenSignal(texture2D(uMask, uv - dx).rgb),
          greenSignal(texture2D(uMask, uv + dx).rgb)
        );
        float sideGreenV = min(
          greenSignal(texture2D(uMask, uv - dy).rgb),
          greenSignal(texture2D(uMask, uv + dy).rgb)
        );
        return whiteLine * max(sideGreenH, sideGreenV);
      }

      void main() {
        vec3 mask = texture2D(uMask, vUv).rgb;
        vec3 shadeSample = texture2D(uShade, vUv).rgb;
        float greenSeparator = greenDoubleFiberSeparator(vUv, mask);

        float shadeLum = dot(shadeSample, vec3(0.299, 0.587, 0.114));
        float sourceMax = max(max(shadeSample.r, shadeSample.g), shadeSample.b);
        float sourceMin = min(min(shadeSample.r, shadeSample.g), shadeSample.b);
        float sourceContrast = clamp((sourceMax - sourceMin) * 1.35, 0.0, 1.0);

        bool isWhiteMask = (mask.r > 0.82 && mask.g > 0.82 && mask.b > 0.82);
        bool isGap = false;
        bool isGreenSeparator = greenSeparator > 0.12;
        bool isC4 = !isGap && mask.r > 0.55 && mask.b > 0.55 && mask.g < 0.45;
        bool isC1 = !isGap && !isGreenSeparator && !isC4 && mask.r >= mask.g && mask.r >= mask.b;
        bool isC2 = !isGap && !isC4 && (isGreenSeparator || isWhiteMask || (mask.g > mask.r && mask.g >= mask.b));
        bool isC3 = !isGap && !isGreenSeparator && !isC4 && mask.b > mask.r && mask.b > mask.g;

        if(isGap){
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }

        vec3 baseCol = uC1;
        if(isC2)      baseCol = uC2;
        else if(isC3) baseCol = uC3;
        else if(isC4) baseCol = uC4;

	        float zoneSignal = shadeLum;
	        if(isC1)      zoneSignal = shadeSample.r;
	        else if(isC2) zoneSignal = sourceMax;
	        else if(isC3) zoneSignal = sourceMax;
	        else if(isC4) zoneSignal = max(shadeSample.r, shadeSample.b);
	
	        float zoneVolume = smoothstep(0.18, 0.82, zoneSignal);
	        if(isC1)      zoneVolume = smoothstep(0.20, 0.62, zoneSignal);
	        else if(isC2) zoneVolume = (isWhiteMask && !isGreenSeparator) ? smoothstep(0.72, 0.99, zoneSignal) : smoothstep(0.24, 0.82, zoneSignal);
	        else if(isC3) zoneVolume = smoothstep(0.22, 0.80, zoneSignal);
	        else if(isC4) zoneVolume = smoothstep(0.20, 0.78, zoneSignal);
	
	        float fibreVolume = clamp(zoneVolume * 0.9 + sourceContrast * 0.1, 0.0, 1.0);
	        fibreVolume = mix(fibreVolume, 0.08, clamp(greenSeparator * 0.92, 0.0, 0.92));
	        float fibreShade = mix(0.74, 1.16, fibreVolume);
	        float groove = (1.0 - fibreVolume) * 0.2 + greenSeparator * 0.56;
	        float satin = fibreVolume * 0.34;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.18, 0.82, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
	        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.06 + satin * 0.1);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.04;

        vec3 shaded = baseCol * fibreShade * diff;
        shaded *= mix(1.0, 0.88, groove);
	        vec3 col = mix(baseCol, shaded, 0.58);
	        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
	        float darkFactor = smoothstep(0.36, 0.02, baseLum);
	        float darkCrest = smoothstep(0.26, 0.9, fibreVolume) * darkFactor;
	        float darkValley = (1.0 - fibreVolume) * darkFactor;
	        col = max(col - vec3(darkValley * 0.035), vec3(0.0));
	        col += vec3(darkCrest * 0.18);
	        float lightFactor = smoothstep(0.68, 0.96, baseLum);
	        float lightValley = (1.0 - fibreVolume) * lightFactor;
	        float lightCrease = sourceContrast * lightFactor;
	        col = max(col - vec3(lightValley * 0.16 + lightCrease * 0.08), vec3(0.0));
	        float c2SeparatorStrength = clamp(greenSeparator * 1.65, 0.0, 1.0);
	        float separatorLum = smoothstep(0.12, 0.84, baseLum);
	        vec3 separatorCol = baseCol * mix(0.56, 0.24, separatorLum);
	        separatorCol += vec3((1.0 - separatorLum) * 0.08);
	        col = mix(col, separatorCol, c2SeparatorStrength * 0.78);
	        col = mix(col, vec3(1.0), spec + rim + satin * 0.018);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
  });
}

function makeChevronMaskShadeMat(maskTex, shadeTex, c1hex, c2hex) {
  
  const maskImg = maskTex?.image;
  const maskTexel = new THREE.Vector2(
    1 / (maskImg?.naturalWidth || maskImg?.width || 4096),
    1 / (maskImg?.naturalHeight || maskImg?.height || 2048)
  );
  if(maskTex.matrixAutoUpdate) maskTex.updateMatrix();
  return createWeaveMaterial({
    uniforms: {
      uMask: { value: maskTex },
      uShade: { value: shadeTex },
      uMaskMatrix: { value: maskTex.matrix.clone() },
      uShadeFlipY: { value: maskTex.flipY === shadeTex.flipY ? 0 : 1 },
      uC1: { value: hexToVec3(c1hex) },
      uC2: { value: hexToVec3(c2hex) },
      uMaskTexel: { value: maskTexel },
    },
    vertexShader: WEAVE_GLSL.vertexMapped,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uShade;
      uniform float uShadeFlipY;
      uniform vec3 uC1, uC2;
      uniform vec2 uMaskTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      float redSignal(vec3 c) {
        return smoothstep(0.08, 0.48, c.r - max(c.g, c.b) * 0.48);
      }

      float greenSignal(vec3 c) {
        return smoothstep(0.08, 0.48, c.g - max(c.r, c.b) * 0.48);
      }

      float separatorSignal(vec3 c) {
        float blue = smoothstep(0.10, 0.50, c.b - max(c.r, c.g) * 0.34);
        float cyan = smoothstep(0.12, 0.46, min(c.g, c.b) - c.r * 0.55);
        return clamp(max(blue, cyan), 0.0, 1.0);
      }

      void addFamily(vec2 uv, inout float red, inout float green) {
        vec3 c = texture2D(uMask, uv).rgb;
        float sep = separatorSignal(c);
        red += redSignal(c) * (1.0 - sep);
        green += greenSignal(c) * (1.0 - sep);
      }

      void main() {
        vec2 px = uMaskTexel;
        vec3 mask = texture2D(uMask, vUv).rgb;
        float separator = separatorSignal(mask);

        float red = redSignal(mask) * (1.0 - separator);
        float green = greenSignal(mask) * (1.0 - separator);

        if(red + green < 0.18) {
          addFamily(vUv + vec2(px.x * 2.0, 0.0), red, green);
          addFamily(vUv - vec2(px.x * 2.0, 0.0), red, green);
          addFamily(vUv + vec2(0.0, px.y * 2.0), red, green);
          addFamily(vUv - vec2(0.0, px.y * 2.0), red, green);
          addFamily(vUv + vec2(px.x * 5.0, 0.0), red, green);
          addFamily(vUv - vec2(px.x * 5.0, 0.0), red, green);
          addFamily(vUv + vec2(0.0, px.y * 5.0), red, green);
          addFamily(vUv - vec2(0.0, px.y * 5.0), red, green);
        }

        float greenRatio = green / max(red + green, 0.0001);
        greenRatio = smoothstep(0.36, 0.64, greenRatio);
        vec3 baseCol = mix(uC1, uC2, greenRatio);

        // Keep the GLB placement, including its texture transform and orientation.
        vec2 shadeUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uShadeFlipY));
        vec3 shade = texture2D(uShade, shadeUv).rgb;
        float shadeValue = max(shade.r, max(shade.g, shade.b));
        float ridge = smoothstep(0.58, 1.0, shadeValue);
        float fibreVolume = mix(ridge, 0.08, clamp(separator * 0.92, 0.0, 0.92));
        float groove = (1.0 - fibreVolume) * 0.20 + separator * 0.56;
        float satin = fibreVolume * 0.34;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.18, 0.82, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.06 + satin * 0.10);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.04;

        vec3 shaded = baseCol * mix(0.74, 1.16, fibreVolume) * diff;
        shaded *= mix(1.0, 0.88, groove);
        vec3 col = mix(baseCol, shaded, 0.58);

        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkFactor = 1.0 - smoothstep(0.02, 0.36, baseLum);
        float lightFactor = smoothstep(0.68, 0.96, baseLum);
        col = max(col - vec3((1.0 - fibreVolume) * darkFactor * 0.035), vec3(0.0));
        col += vec3(smoothstep(0.26, 0.90, fibreVolume) * darkFactor * 0.18);
        col = max(col - vec3(lightFactor * (1.0 - fibreVolume) * 0.16), vec3(0.0));

        float separatorStrength = clamp(separator * 1.65, 0.0, 1.0);
        float separatorLum = smoothstep(0.12, 0.84, baseLum);
        vec3 separatorCol = baseCol * mix(0.56, 0.24, separatorLum);
        separatorCol += vec3((1.0 - separatorLum) * 0.08);
        col = mix(col, separatorCol, separatorStrength * 0.78);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.018);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true,
  });
}

function makeChevronColorSwapMat(bakedTex, c1hex, c2hex) {
  
  const img=bakedTex?.image;
  const texel=new THREE.Vector2(1/(img?.width||2048),1/(img?.height||1024));
  return createWeaveMaterial({
    uniforms: {
      uTex: { value: bakedTex },
      uC1:  { value: hexToVec3(c1hex) },
      uC2:  { value: hexToVec3(c2hex) },
      uTexel: { value: texel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uC1, uC2;
      uniform vec2 uTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      float redSignal(vec3 c) {
        return smoothstep(0.08, 0.46, c.r - max(c.g, c.b) * 0.48);
      }

      float greenSignal(vec3 c) {
        return smoothstep(0.08, 0.46, c.g - max(c.r, c.b) * 0.48);
      }

      float separatorSignal(vec3 c) {
        float blue = smoothstep(0.08, 0.56, c.b - max(c.r, c.g) * 0.32);
        float cyan = smoothstep(0.10, 0.52, min(c.g, c.b) - c.r * 0.48);
        return clamp(max(blue, cyan), 0.0, 1.0);
      }

      float familyId(vec3 c) {
        float sep = separatorSignal(c);
        float r = redSignal(c);
        float g = greenSignal(c);
        if(sep > 0.30 && max(r, g) < 0.55) return 0.0;
        return g > r ? 2.0 : 1.0;
      }

      ${WEAVE_GLSL.sameFamily}

      float grooveAt(vec2 uv, float id) {
        vec3 c = texture2D(uTex, uv).rgb;
        float sep = separatorSignal(c);
        float other = familyId(c);
        float boundary = step(0.25, abs(other - id));
        return clamp(max(sep, boundary * 0.78), 0.0, 1.0);
      }

      float continuity(vec2 dir, float id) {
        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
        float c = 0.0;
        c += sameFamily(vUv + dir * px * 8.0, id) + sameFamily(vUv - dir * px * 8.0, id);
        c += sameFamily(vUv + dir * px * 18.0, id) + sameFamily(vUv - dir * px * 18.0, id);
        c += sameFamily(vUv + dir * px * 42.0, id) + sameFamily(vUv - dir * px * 42.0, id);
        c += sameFamily(vUv + dir * px * 86.0, id) + sameFamily(vUv - dir * px * 86.0, id);
        return c * 0.125;
      }

      float distanceFromGroove(vec2 crossDir, float id) {
        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
        float nearest = 1.0;
        for(int i = 0; i < 18; i++) {
          float d = 2.0 + float(i) * 5.0;
          float hit = max(grooveAt(vUv + crossDir * px * d, id), grooveAt(vUv - crossDir * px * d, id));
          nearest = min(nearest, mix(1.0, d / 87.0, hit));
        }
        return clamp(nearest, 0.0, 1.0);
      }

      void main() {
        vec3 baked = texture2D(uTex, vUv).rgb;
        vec2 px = max(uTexel, vec2(1.0 / 4096.0));

        float red = redSignal(baked);
        float green = greenSignal(baked);
        float directTotal = red + green;

        if(directTotal < 0.10) {
          vec3 l = texture2D(uTex, vUv - vec2(px.x * 2.0, 0.0)).rgb;
          vec3 r = texture2D(uTex, vUv + vec2(px.x * 2.0, 0.0)).rgb;
          vec3 d = texture2D(uTex, vUv - vec2(0.0, px.y * 2.0)).rgb;
          vec3 u = texture2D(uTex, vUv + vec2(0.0, px.y * 2.0)).rgb;
          red += redSignal(l) + redSignal(r) + redSignal(d) + redSignal(u);
          green += greenSignal(l) + greenSignal(r) + greenSignal(d) + greenSignal(u);
        }

        float greenRatio = green / max(red + green, 0.0001);
        float id = greenRatio > 0.5 ? 2.0 : 1.0;
        vec3 baseCol = mix(uC1, uC2, greenRatio);

        vec2 xDir = vec2(1.0, 0.0);
        vec2 yDir = vec2(0.0, 1.0);
        float contX = continuity(xDir, id);
        float contY = continuity(yDir, id);
        vec2 alongDir = contX >= contY ? xDir : yDir;
        vec2 crossDir = contX >= contY ? yDir : xDir;

        float localGroove = grooveAt(vUv, id);
        localGroove = max(localGroove, grooveAt(vUv + crossDir * px * 1.4, id) * 0.82);
        localGroove = max(localGroove, grooveAt(vUv - crossDir * px * 1.4, id) * 0.82);

        float dist = distanceFromGroove(crossDir, id);
        float bandCore = smoothstep(0.10, 0.88, dist);
        float crest = pow(bandCore, 1.45);
        float groove = clamp(localGroove * 0.45 + (1.0 - bandCore) * 0.19, 0.0, 0.55);

        float along = dot(vUv, alongDir);
        float cross = dot(vUv, crossDir);
        float grain = 0.5 + 0.5 * sin(along * 1450.0 + sin(cross * 95.0) * 0.75);
        float fine = 0.5 + 0.5 * sin(along * 3900.0 + cross * 280.0);
        float fibreVolume = clamp(0.58 + crest * 0.38 - groove * 0.22 + (grain - 0.5) * 0.035 + (fine - 0.5) * 0.012, 0.0, 1.0);
        float satin = crest * 0.30 + grain * 0.030;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.20, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.93 + ndl * 0.10;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 44.0) * (0.045 + satin * 0.12);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.035;

        vec3 col = baseCol * mix(0.72, 1.17, fibreVolume) * diff;
        col *= mix(1.0, 0.78, groove);

        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkFactor = smoothstep(0.34, 0.02, baseLum);
        float lightFactor = smoothstep(0.68, 0.98, baseLum);
        col += vec3(darkFactor * crest * 0.16);
        col = max(col - vec3((darkFactor * groove * 0.05) + (lightFactor * groove * 0.17)), vec3(0.0));

        col = mix(baseCol, col, 0.70);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.010);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeNatteColorSwapMat(bakedTex, c1hex, c2hex, c3hex) {
  
  const img=bakedTex?.image;
  const texel=new THREE.Vector2(1/(img?.width||1024),1/(img?.height||768));
  return createWeaveMaterial({
    uniforms: {
      uTex: { value: bakedTex },
      uC1:  { value: hexToVec3(c1hex) },
      uC2:  { value: hexToVec3(c2hex) },
      uC3:  { value: hexToVec3(c3hex) },
      uTexel: { value: texel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uC1, uC2, uC3;
      uniform vec2 uTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      float luminance(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      vec3 familySignals(vec3 c) {
        float red = smoothstep(0.08, 0.45, c.r - max(c.g, c.b) * 0.52);
        float green = smoothstep(0.08, 0.45, c.g - max(c.r, c.b) * 0.52);
        float blue = smoothstep(0.08, 0.45, c.b - max(c.r, c.g) * 0.52);
        float magenta = smoothstep(0.12, 0.48, min(c.r, c.b) - c.g * 0.48);
        blue = max(blue, magenta);

        float totalMask = red + green + blue;
        if(totalMask > 0.08) return vec3(red, green, blue);

        float lum = luminance(c);
        float hi = max(max(c.r, c.g), c.b);
        float lo = min(min(c.r, c.g), c.b);
        float contrast = clamp((hi - lo) * 1.6, 0.0, 1.0);
        float dark = smoothstep(0.46, 0.08, lum + contrast * 0.03);
        float light = smoothstep(0.46, 0.88, lum + contrast * 0.04);
        float mid = 1.0 - max(dark, light);
        return vec3(dark, mid, light);
      }

      float familyId(vec3 c) {
        vec3 s = familySignals(c);
        if(s.x >= s.y && s.x >= s.z) return 1.0;
        if(s.y >= s.x && s.y >= s.z) return 2.0;
        return 3.0;
      }

      ${WEAVE_GLSL.sameFamily}

      float grooveAt(vec2 uv, float id) {
        float other = familyId(texture2D(uTex, uv).rgb);
        return step(0.25, abs(other - id));
      }

      float continuity(vec2 dir, float id) {
        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
        float c = 0.0;
        c += sameFamily(vUv + dir * px * 7.0, id) + sameFamily(vUv - dir * px * 7.0, id);
        c += sameFamily(vUv + dir * px * 18.0, id) + sameFamily(vUv - dir * px * 18.0, id);
        c += sameFamily(vUv + dir * px * 42.0, id) + sameFamily(vUv - dir * px * 42.0, id);
        c += sameFamily(vUv + dir * px * 90.0, id) + sameFamily(vUv - dir * px * 90.0, id);
        return c * 0.125;
      }

	      float distanceFromGroove(vec2 crossDir, float id) {
	        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
	        float nearest = 1.0;
	        for(int i = 0; i < 26; i++) {
	          float d = 1.5 + float(i) * 4.0;
	          float hit = max(grooveAt(vUv + crossDir * px * d, id), grooveAt(vUv - crossDir * px * d, id));
	          nearest = min(nearest, mix(1.0, d / 101.5, hit));
	        }
	        return clamp(nearest, 0.0, 1.0);
	      }

      void main() {
        vec3 baked = texture2D(uTex, vUv).rgb;
        vec3 signals = familySignals(baked);
        float total = max(signals.x + signals.y + signals.z, 0.0001);
        signals /= total;

        float id = 1.0;
        if(signals.y >= signals.x && signals.y >= signals.z) id = 2.0;
        else if(signals.z >= signals.x && signals.z >= signals.y) id = 3.0;

        vec3 baseCol = uC1 * signals.x + uC2 * signals.y + uC3 * signals.z;

        vec2 xDir = vec2(1.0, 0.0);
        vec2 yDir = vec2(0.0, 1.0);
        float contX = continuity(xDir, id);
        float contY = continuity(yDir, id);
        vec2 alongDir = contX >= contY ? xDir : yDir;
        vec2 crossDir = contX >= contY ? yDir : xDir;
        vec2 px = max(uTexel, vec2(1.0 / 4096.0));

        float boundary = grooveAt(vUv, id);
        boundary = max(boundary, grooveAt(vUv + crossDir * px * 1.5, id) * 0.84);
        boundary = max(boundary, grooveAt(vUv - crossDir * px * 1.5, id) * 0.84);
        boundary = max(boundary, grooveAt(vUv + alongDir * px * 1.5, id) * 0.42);
        boundary = max(boundary, grooveAt(vUv - alongDir * px * 1.5, id) * 0.42);

        float dist = distanceFromGroove(crossDir, id);
	        float bandCore = smoothstep(0.06, 0.96, dist);
	        float crest = pow(bandCore, 1.12);
	        float groove = clamp(boundary * 0.56 + (1.0 - bandCore) * 0.28, 0.0, 0.68);

	        float along = dot(vUv, alongDir);
	        float cross = dot(vUv, crossDir);
	        float broadSheen = 0.5 + 0.5 * sin(cross * 13.0 + along * 2.0);
	        float grain = 0.5 + 0.5 * sin(along * 720.0 + sin(cross * 58.0) * 0.55);
	        float fine = 0.5 + 0.5 * sin(along * 1800.0 + cross * 180.0);
	        float sourceLum = luminance(baked);
	        float sourceContrast = max(max(baked.r, baked.g), baked.b) - min(min(baked.r, baked.g), baked.b);
	        float bakedRelief = smoothstep(0.14, 0.92, sourceLum + sourceContrast * 0.10);
	        float fibreVolume = clamp(0.50 + crest * 0.30 + bakedRelief * 0.18 - groove * 0.26 + (broadSheen - 0.5) * 0.030 + (grain - 0.5) * 0.018 + (fine - 0.5) * 0.006, 0.0, 1.0);
	        float satin = crest * 0.20 + broadSheen * 0.030 + grain * 0.012;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.20, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.93 + ndl * 0.10;
        vec3 H = normalize(L + V);
	        float spec = pow(max(dot(N, H), 0.0), 54.0) * (0.030 + satin * 0.070);
	        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.45) * 0.025;

	        vec3 col = baseCol * mix(0.78, 1.10, fibreVolume) * diff;
	        col *= mix(1.0, 0.70, groove);

        float baseLum = luminance(baseCol);
        float darkFactor = smoothstep(0.34, 0.02, baseLum);
        float lightFactor = smoothstep(0.68, 0.98, baseLum);
	        col += vec3(darkFactor * crest * 0.10);
	        col = max(col - vec3((darkFactor * groove * 0.065) + (lightFactor * groove * 0.22)), vec3(0.0));

	        col = mix(baseCol, col, 0.64);
	        col = mix(col, vec3(1.0), spec + rim + satin * 0.006);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeColorSwapMat(bakedTex, c1hex, c2hex, c3hex, c4hex) {
  
  const img=bakedTex?.image;
  const texel=new THREE.Vector2(1/(img?.width||2048),1/(img?.height||2048));
  return createWeaveMaterial({
    uniforms: {
      uTex: { value: bakedTex },
      uC1:  { value: hexToVec3(c1hex) },
      uC2:  { value: hexToVec3(c2hex) },
      uC3:  { value: hexToVec3(c3hex) },
      uC4:  { value: hexToVec3(c4hex || c3hex) },
      uTexel: { value: texel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uC1, uC2, uC3, uC4;
      uniform vec2 uTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      float sourceClass(vec3 c) {
        if(c.r > 0.55 && c.b > 0.55 && c.g < 0.42) return 4.0;
        if(c.r > 0.55 && c.g < 0.42 && c.b < 0.42) return 1.0;
        if(c.g > 0.55 && c.r < 0.42 && c.b < 0.42) return 2.0;
        if(c.b > 0.55 && c.r < 0.42 && c.g < 0.42) return 3.0;
        return 0.0;
      }

      float sameClass(vec2 uv, float id) {
        float other = sourceClass(texture2D(uTex, uv).rgb);
        return 1.0 - step(0.25, abs(other - id));
      }

      void main() {
        vec4 baked = texture2D(uTex, vUv);
        float r = baked.r, g = baked.g, b = baked.b;
        float srcId = sourceClass(baked.rgb);

        vec3 baseCol;
        if(srcId == 1.0)      baseCol = uC1;
        else if(srcId == 2.0) baseCol = uC2;
        else if(srcId == 3.0) baseCol = uC3;
        else if(srcId == 4.0) baseCol = uC4;
        else {
          float lum = 0.299*r + 0.587*g + 0.114*b;
          gl_FragColor = vec4(vec3(mix(0.11, 0.44, lum)), 1.0);
          return;
        }

        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
        float sameL = sameClass(vUv - vec2(px.x, 0.0), srcId);
        float sameR = sameClass(vUv + vec2(px.x, 0.0), srcId);
        float sameD = sameClass(vUv - vec2(0.0, px.y), srcId);
        float sameU = sameClass(vUv + vec2(0.0, px.y), srcId);
        float sameL2 = sameClass(vUv - vec2(px.x * 2.0, 0.0), srcId);
        float sameR2 = sameClass(vUv + vec2(px.x * 2.0, 0.0), srcId);
        float sameD2 = sameClass(vUv - vec2(0.0, px.y * 2.0), srcId);
        float sameU2 = sameClass(vUv + vec2(0.0, px.y * 2.0), srcId);
        float sameP = sameClass(vUv + vec2(px.x, px.y), srcId) + sameClass(vUv - vec2(px.x, px.y), srcId);
        float sameM = sameClass(vUv + vec2(px.x, -px.y), srcId) + sameClass(vUv - vec2(px.x, -px.y), srcId);

        float contX = sameL + sameR + sameL2 + sameR2;
        float contY = sameD + sameU + sameD2 + sameU2;
        float contP = sameP * 2.0;
        float contM = sameM * 2.0;
        float edge = 1.0 - clamp((sameL + sameR + sameD + sameU) * 0.25, 0.0, 1.0);

        float along = vUv.x;
        float cross = vUv.y;
        if(contY > contX && contY >= contP && contY >= contM) {
          along = vUv.y;
          cross = vUv.x;
        } else if(contP > contX && contP > contY && contP >= contM) {
          along = (vUv.x + vUv.y) * 0.7071;
          cross = (vUv.x - vUv.y) * 0.7071;
        } else if(contM > contX && contM > contY && contM > contP) {
          along = (vUv.x - vUv.y) * 0.7071;
          cross = (vUv.x + vUv.y) * 0.7071;
        }

        float ridge = 0.5 + 0.5 * sin(cross * 760.0);
        float grain = 0.5 + 0.5 * sin(along * 420.0 + sin(cross * 95.0) * 0.8);
        float centre = clamp(max(max(contX, contY), max(contP, contM)) * 0.25, 0.0, 1.0);
        float fibreVolume = clamp(0.70 + centre * 0.28 - edge * 0.22 + (ridge - 0.5) * 0.09 + (grain - 0.5) * 0.035, 0.0, 1.0);
        float groove = clamp(edge * 0.38 + (1.0 - ridge) * 0.055, 0.0, 0.48);
        float satin = smoothstep(0.55, 1.0, fibreVolume) * 0.24 + ridge * 0.035;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.18, 0.82, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 46.0) * (0.045 + satin * 0.12);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.035;

        vec3 shaded = baseCol * mix(0.78, 1.15, fibreVolume) * diff;
        shaded *= mix(1.0, 0.84, groove);
        vec3 col = mix(baseCol, shaded, 0.66);

        float baseLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkFactor = smoothstep(0.34, 0.02, baseLum);
        float lightFactor = smoothstep(0.68, 0.98, baseLum);
        col += vec3(darkFactor * smoothstep(0.70, 1.0, fibreVolume) * 0.18);
        col = max(col - vec3((darkFactor * groove * 0.035) + (lightFactor * groove * 0.18)), vec3(0.0));
        col = mix(col, vec3(1.0), spec + rim + satin * 0.012);
        col = clamp(col, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeBourdonMaskShadeMat(maskTex, shadeTex, c1hex, c2hex) {
  
  const maskImg = maskTex?.image;
  const shadeImg = shadeTex?.image;
  const maskTexel = new THREE.Vector2(1 / (maskImg?.width || 2048), 1 / (maskImg?.height || 2048));
  const shadeTexel = new THREE.Vector2(1 / (shadeImg?.width || 4096), 1 / (shadeImg?.height || 2284));
  return createWeaveMaterial({
    uniforms: {
      uMask: { value: maskTex },
      uShade: { value: shadeTex },
      uReferenceMask: {value:getDataTexture('textures/bourdon-mask.png',{nearest:true})},
      uReferenceFlipY: {value:maskTex.flipY===shadeTex.flipY?0:1},
      uC1: { value: hexToVec3(c1hex) },
      uC2: { value: hexToVec3(c2hex) },
      uMaskTexel: { value: maskTexel },
      uShadeTexel: { value: shadeTexel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform sampler2D uShade;
      uniform sampler2D uReferenceMask;
      uniform float uReferenceFlipY;
      uniform vec3 uC1, uC2;
      uniform vec2 uMaskTexel, uShadeTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      // Separate the reference pigments before measuring their subtle relief.
      ${WEAVE_GLSL.bourdonReferenceFamily}
      ${WEAVE_GLSL.bourdonReferenceRelief}

      float lum(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      float warmSignal(vec3 c) {
        return smoothstep(0.05, 0.32, c.r - max(c.g, c.b) * 0.64);
      }

      float maskFamily(vec3 c) {
        return step(c.g,c.r);
      }

      float familyAt(vec2 uv) {
        return maskFamily(texture2D(uMask, uv).rgb);
      }

      float boundaryAt(vec2 uv, float currentFamily) {
        return smoothstep(0.12, 0.44, abs(familyAt(uv) - currentFamily));
      }

      float shadeRelief(vec3 c) {
        float l = lum(c);
        float hi = max(max(c.r, c.g), c.b);
        float lo = min(min(c.r, c.g), c.b);
        return smoothstep(0.18, 0.84, l + (hi - lo) * 0.08);
      }

      void main() {
        vec3 maskSrc = texture2D(uMask, vUv).rgb;
        // The GLB mask contains five vertical cycles of the supplied strip.
        // Leave its coordinates untouched; tile only the relief references.
        vec2 shadeUv=vec2(vUv.x,vUv.y*5.0);
        shadeUv.y=mix(shadeUv.y,1.0-shadeUv.y,uReferenceFlipY);
        vec3 shadeSrc = texture2D(uShade, shadeUv).rgb;
        vec3 referenceMask=texture2D(uReferenceMask,shadeUv).rgb;
        float family = maskFamily(maskSrc);
        vec3 baseCol = mix(uC2, uC1, family);

        vec2 px = max(uMaskTexel, vec2(1.0 / 4096.0));
        float edge = 0.0;
        edge = max(edge, boundaryAt(vUv + vec2(px.x, 0.0), family));
        edge = max(edge, boundaryAt(vUv - vec2(px.x, 0.0), family));
        edge = max(edge, boundaryAt(vUv + vec2(0.0, px.y), family));
        edge = max(edge, boundaryAt(vUv - vec2(0.0, px.y), family));
        edge = max(edge, boundaryAt(vUv + vec2(px.x * 2.0, 0.0), family) * 0.64);
        edge = max(edge, boundaryAt(vUv - vec2(px.x * 2.0, 0.0), family) * 0.64);

        float referenceRed=step(referenceMask.g,referenceMask.r);
        float shadeVolume=mix(smoothstep(0.64,0.76,shadeSrc.r),
          smoothstep(0.47,0.57,shadeSrc.r),referenceRed);
        float fibreVolume=clamp(shadeVolume-edge*0.12,0.0,1.0);
        float groove=clamp(edge*0.32+(1.0-shadeVolume)*0.16,0.0,0.50);
        float satin=shadeVolume*0.28;

        vec3 N = normalize(vNormalW);
        if(!gl_FrontFacing) N=-N;
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.20, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.034 + satin * 0.10);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.026;

        vec3 col = baseCol * mix(0.76, 1.13, fibreVolume) * diff;
        col *= mix(1.0, 0.78, groove);

        float baseLum = lum(baseCol);
        float darkFactor = (1.0-smoothstep(0.02,0.34,baseLum));
        float lightFactor = smoothstep(0.68, 0.98, baseLum);
        col += vec3(darkFactor * shadeVolume * 0.11);
        col = max(col - vec3((darkFactor * groove * 0.035) + (lightFactor * groove * 0.13)), vec3(0.0));
        col = mix(baseCol, col, 0.68);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.006);

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  });
}

function makeBourdonShadeMat(shadeTex, c1hex, c2hex) {
  
  const img = shadeTex?.image;
  const texel = new THREE.Vector2(1 / (img?.width || 4096), 1 / (img?.height || 2284));
  return createWeaveMaterial({
    uniforms: {
      uShade: { value: shadeTex },
      uC1: { value: hexToVec3(c1hex) },
      uC2: { value: hexToVec3(c2hex) },
      uTexel: { value: texel },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform sampler2D uShade;
      uniform vec3 uC1, uC2;
      uniform vec2 uTexel;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      // Separate the reference pigments before measuring their subtle relief.
      ${WEAVE_GLSL.bourdonReferenceFamily}
      ${WEAVE_GLSL.bourdonReferenceRelief}

      float lum(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      float familyOne(vec3 c) {
        return referenceFamily(c);
      }

      float familyAt(vec2 uv) {
        return familyOne(texture2D(uShade, uv).rgb);
      }

      float boundaryAt(vec2 uv, float currentFamily) {
        return smoothstep(0.14, 0.52, abs(familyAt(uv) - currentFamily));
      }

      void main() {
        vec3 src = texture2D(uShade, vUv).rgb;
        float family = familyOne(src);
        vec3 baseCol = mix(uC2, uC1, family);

        vec2 px = max(uTexel, vec2(1.0 / 4096.0));
        float relief=referenceRelief(src);

        float edge = 0.0;
        edge = max(edge, boundaryAt(vUv + vec2(px.x, 0.0), family));
        edge = max(edge, boundaryAt(vUv - vec2(px.x, 0.0), family));
        edge = max(edge, boundaryAt(vUv + vec2(0.0, px.y), family));
        edge = max(edge, boundaryAt(vUv - vec2(0.0, px.y), family));
        edge = max(edge, boundaryAt(vUv + vec2(px.x * 2.0, 0.0), family) * 0.62);
        edge = max(edge, boundaryAt(vUv - vec2(px.x * 2.0, 0.0), family) * 0.62);

        float volume=clamp(relief-edge*0.12,0.0,1.0);
        float groove=clamp(edge*0.32+(1.0-relief)*0.16,0.0,0.50);
        float satin=relief*0.28;

        vec3 N = normalize(vNormalW);
        if(!gl_FrontFacing) N=-N;
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.20, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.035 + satin * 0.11);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.030;

        vec3 col = baseCol * mix(0.76, 1.14, volume) * diff;
        col *= mix(1.0, 0.80, groove);

        float baseLum = lum(baseCol);
        float darkFactor = (1.0-smoothstep(0.02,0.34,baseLum));
        float lightFactor = smoothstep(0.68, 0.98, baseLum);
        col += vec3(darkFactor * relief * 0.12);
        col = max(col - vec3((darkFactor * groove * 0.035) + (lightFactor * groove * 0.14)), vec3(0.0));
        col = mix(baseCol, col, 0.70);
        col = mix(col, vec3(1.0), spec + rim + satin * 0.008);

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  });
}

function makeBourdonRuntimeMat(c1hex, c2hex) {
  
  return createWeaveMaterial({
    uniforms: {
      uC1: { value: hexToVec3(c1hex) },
      uC2: { value: hexToVec3(c2hex) },
    },
    vertexShader: WEAVE_GLSL.vertexUv,
    fragmentShader: `
      uniform vec3 uC1, uC2;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;

      void main() {
        float band = floor(vUv.x * 18.0);
        float group = mod(floor(band / 4.0), 2.0);
        vec3 baseCol = mix(uC1, uC2, group);

        float rib = 0.5 + 0.5 * sin(vUv.x * 18.0 * 6.28318 * 2.0);
        float grain = 0.5 + 0.5 * sin(vUv.y * 980.0 + sin(vUv.x * 120.0) * 0.6);
        vec2 cell = fract(vec2(vUv.x * 18.0, vUv.y * 9.0));
        float dotMark = smoothstep(0.08, 0.0, length(cell - vec2(0.50, 0.50)));

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        vec3 L = normalize(vec3(-0.20, 0.84, 0.48));
        float ndl = max(dot(N, L), 0.0);
        float diff = 0.94 + ndl * 0.08;
        vec3 H = normalize(L + V);
        float satin = pow(rib, 1.35) * 0.20 + grain * 0.025;
        float spec = pow(max(dot(N, H), 0.0), 42.0) * (0.030 + satin * 0.11);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35) * 0.030;

        float volume = clamp(0.70 + rib * 0.24 + (grain - 0.5) * 0.035, 0.0, 1.0);
        vec3 col = baseCol * mix(0.78, 1.12, volume) * diff;
        col = mix(col, vec3(1.0), spec + rim);
        col = mix(col, baseCol * 0.70, dotMark * 0.32);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  });
}