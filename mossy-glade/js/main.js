// ============================================================
// THE MOSSY GLADE — an immersive 3D print shop
// Cinematic forest: real-time shadows with dappled canopy
// light, volumetric god rays, bloom, reflective stream water,
// trees, ferns, drifting spores and bioluminescent accents.
// Four print cards hover in the moss (one drifts on the water)
// and check out through Shopify variant IDs.
// ============================================================

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHOPIFY, isConfigured, checkoutUrl, buildCheckoutUrl } from './shopify-config.js';

// ------------------------------------------------------------
// Deterministic layout — seed Math.random (mulberry32) so the trees,
// branches, grass, boulders, ferns and flowers lay out IDENTICALLY on
// every load instead of re-randomising each reload.
// ------------------------------------------------------------
(function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(1337);

// Mobile/phone flag (defined early so layout can adapt before anything is placed).
const IS_MOBILE = window.matchMedia('(max-width: 767px)').matches ||
  (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);

// ------------------------------------------------------------
// Product catalog — `key` maps to SHOPIFY.variants in
// js/shopify-config.js. Swap art / copy / prices here.
// ------------------------------------------------------------
const PRODUCTS = [
  {
    key: 'argentina',
    title: 'Argentina, 2024',
    subtitle: 'Bougainvillea & Mountains',
    description: 'Captured in the foothills of the Argentine Andes, this print celebrates vivid bougainvillea against weathered terracotta walls and silent peaks.',
    paper: 'Cotton matte, 320 gsm',
    size: '5" × 7"',
    edition: 'Open edition · signed',
    price: 8.00,
    img: 'assets/cards/argentina_front.jpg',
    rest: { x: -2.75, z: 1.7, yaw: 0.5 },   // left bank — leans inward toward the stream
    floats: false
  },
  {
    key: 'botanical',
    title: 'Chicago, 2024',
    subtitle: 'Willow & Magnolia at the Botanical Garden',
    description: 'A spring morning at the Chicago Botanic Garden, where weeping willows meet star magnolias in full bloom across a quiet pond.',
    paper: 'Cotton matte, 320 gsm',
    size: '5" × 7"',
    edition: 'Open edition · signed',
    price: 8.00,
    img: 'assets/cards/botanical_front.jpg',
    rest: { x: 2.65, z: 0.3, yaw: -0.5 },   // right bank — leans inward toward the stream
    floats: false
  },
  {
    key: 'horse',
    title: 'Chicago, 2024',
    subtitle: 'Paint Horse at Dusk',
    description: 'A working paint horse tied beside a weathered trailer, framed by old oaks at the edge of evening light.',
    paper: 'Cotton matte, 320 gsm',
    size: '5" × 7"',
    edition: 'Open edition · signed',
    price: 8.00,
    img: 'assets/cards/horse_front.jpg',
    rest: { x: -2.95, z: -2.4, yaw: 0.42 },   // left bank (back) — leans inward toward the stream
    floats: false
  },
  {
    key: 'neworleans',
    title: 'New Orleans, 2024',
    subtitle: 'Live Oak at Sunset',
    description: 'Late golden light filtering through a centuries-old live oak in City Park — this one drifts on the stream, reflected in moving water.',
    paper: 'Cotton matte, 320 gsm',
    size: '5" × 7"',
    edition: 'Open edition · signed',
    price: 8.00,
    img: 'assets/cards/neworleans_front.jpg',
    back: 'assets/cards/neworleans_back.jpg',   // gold "Thinking of You" message
    rest: { x: 0, z: 1.3, yaw: 0.1 },   // drifts along the stream — x/z recomputed live
    floats: true
  }
];
// On a narrow phone, give the grounded cards distinct, spread-out spots around
// the stream (left-near, right-mid, centre-back) so they read as separate,
// individually-clickable prints rather than a bunched-up pile — all in frame.
if (IS_MOBILE) {
  const mob = {
    argentina: { x: -1.05, z: 1.6, yaw: 0.5 },    // left bank, near
    botanical: { x: 1.55, z: 0.3, yaw: -0.5 },   // right bank, mid
    horse: { x: 0.7, z: -3.2, yaw: -0.35 }        // right bank, set back up the stream
  };
  PRODUCTS.forEach((p) => {
    const m = mob[p.key];
    if (m) { p.rest.x = m.x; p.rest.z = m.z; p.rest.yaw = m.yaw; }
  });
}
const CARD_BACK_IMG = 'assets/cards/card_back.jpg';

// ------------------------------------------------------------
// World constants
// ------------------------------------------------------------
const WATER_Y = -0.46;
const FOG_COLOR = new THREE.Color(0xbcc6bb);   // pale cool mist — distance dissolves into ghostly fog
const FOG_DENSITY = 0.039;                      // dense, enveloping woodland fog
const SUN_POS = new THREE.Vector3(-7, 16, -11);     // soft diffuse overcast light from above
const SUN_DIR = SUN_POS.clone().normalize();
const CARD_W = 1.05;
const CARD_H = CARD_W * (1024 / 723);

function streamCenterX(z) { return Math.sin(z * 0.30) * 1.6; }

// CPU value noise (placement + terrain heights)
function fract(x) { return x - Math.floor(x); }
function hash2(x, z) { return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453); }
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function groundHeight(x, z) {
  const base = -0.25 + 0.85 * (0.6 * vnoise(x * 0.22, z * 0.22) + 0.4 * vnoise(x * 0.55 + 31.7, z * 0.55 + 11.3));
  const d = Math.abs(x - streamCenterX(z));
  const ch = 1 - smoothstep(0.5, 1.8, d);
  return base * (1 - ch * 0.5) - ch * 0.85;
}

// Grounded card footprints — nothing should grow through or cover a resting print.
const CARD_BLOCKERS = PRODUCTS.filter((p) => !p.floats).map((p) => ({ x: p.rest.x, z: p.rest.z }));
function nearCard(x, z, r) {
  for (let i = 0; i < CARD_BLOCKERS.length; i++) {
    const dx = x - CARD_BLOCKERS[i].x, dz = z - CARD_BLOCKERS[i].z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// ------------------------------------------------------------
// Renderer / scene / camera / post-processing
// ------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  if (window.__bootError) window.__bootError('WebGL could not start: ' + err.message);
  throw err;
}
// Mobile: same scene, scaled down so it runs smoothly on touch devices.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.9 : 1.6));   // sharper prints on phones
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = !IS_MOBILE;          // drop the shadow pass on phones (subtle in fog)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

// On a narrow/portrait phone the cards span more than the horizontal view, so
// widen the lens and pull back so the whole glade still fits.
const _portrait = window.innerHeight > window.innerWidth;
const camera = new THREE.PerspectiveCamera(IS_MOBILE ? (_portrait ? 64 : 56) : 50, window.innerWidth / window.innerHeight, 0.1, 160);
const CAM_BASE = new THREE.Vector3(0, IS_MOBILE ? 3.2 : 3.2, IS_MOBILE ? 6.6 : 6.4);   // mobile: zoomed in more
const CAM_LOOK = new THREE.Vector3(0, 0.75, -1.6);   // frame the arching gnarled limbs
camera.position.copy(CAM_BASE);
camera.lookAt(CAM_LOOK);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Sanitize pass — runs BEFORE bloom. A single NaN/Inf fragment (e.g. from a
// reflection or shader edge case) renders black and, once bloom downsamples it,
// smears into a flickering square block. We replace any NaN/Inf with black and
// clamp absurd values, so a stray bad pixel can never become a visible square.
// Identity for all normal pixels — the scene looks exactly the same.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // NaN fails self-equality; Inf survives clamp — guard both.
      bvec3 bad = bvec3(!(c.r == c.r), !(c.g == c.g), !(c.b == c.b));
      c.rgb = mix(c.rgb, vec3(0.0), vec3(bad));
      c.rgb = clamp(c.rgb, 0.0, 64.0);
      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `
};
composer.addPass(new ShaderPass(SanitizeShader));

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.24, 0.6, 0.85);
composer.addPass(bloom);

// gentle colour grade — lift saturation (and a touch of warmth) so the misty
// palette feels alive rather than washed-out, without losing the moody fog
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.24 }, uWarm: { value: 0.04 } },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uWarm;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);          // saturation lift
      c.rgb *= vec3(1.0 + uWarm, 1.0, 1.0 - uWarm * 0.6);   // subtle warmth
      gl_FragColor = c;
    }
  `
};
composer.addPass(new ShaderPass(GradeShader));
composer.addPass(new OutputPass());

function resizeRenderer() {
  const el = renderer.domElement;
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.9 : 1.6));
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resizeRenderer();

// ------------------------------------------------------------
// Lighting — low golden sun from behind the trees, teal sky fill
// ------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xcfd5c8, 0x555c4a, 1.2));    // cool overcast sky, soft mossy ground bounce

const sun = new THREE.DirectionalLight(0xd7dccf, 0.9);            // soft, near-shadowless misty daylight
sun.position.copy(SUN_POS);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// soft cool fill from the viewer's side so the prints stay readable
const fill = new THREE.DirectionalLight(0xc6d0c6, 0.45);
fill.position.set(4, 6, 14);
scene.add(fill);

// ------------------------------------------------------------
// Shared GLSL helpers
// ------------------------------------------------------------
const GLSL_NOISE = `
  float ghash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(ghash(i), ghash(i + vec2(1,0)), u.x),
               mix(ghash(i + vec2(0,1)), ghash(i + vec2(1,1)), u.x), u.y);
  }
  float gfbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++){ v += a * gnoise(p); p *= 2.13; a *= 0.5; }
    return v;
  }
`;
const GLSL_FOG = `
  vec3 applyFog(vec3 col, float depth){
    float f = 1.0 - exp(-pow(${FOG_DENSITY} * depth, 2.0));
    return mix(col, vec3(${FOG_COLOR.r.toFixed(3)}, ${FOG_COLOR.g.toFixed(3)}, ${FOG_COLOR.b.toFixed(3)}), f);
  }
`;

// ------------------------------------------------------------
// Canvas-painted textures (leaves, ferns, bark, treeline, glow)
// ------------------------------------------------------------
function canvasTexture(size, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = opts.w || size; c.height = opts.h || size;
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const leafTex = canvasTexture(512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 340; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * w * 0.46;
    const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.85;
    const len = 9 + Math.random() * 20, wid = 4 + Math.random() * 9;
    // muted forest-leaf greens (lower saturation, some olive/yellowed)
    const hue = 78 + Math.random() * 46, lit = 12 + Math.random() * 22;
    g.save();
    g.translate(x, y);
    g.rotate(Math.random() * Math.PI * 2);
    g.fillStyle = `hsla(${hue}, ${24 + Math.random() * 18}%, ${lit}%, ${0.85 + Math.random() * 0.15})`;
    g.beginPath();
    g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
});

const fernTex = canvasTexture(512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const ox = w / 2, oy = h - 8;
  for (let f = 0; f < 9; f++) {
    const ang = -Math.PI / 2 + (f - 4) * 0.30 + (Math.random() - 0.5) * 0.12;
    const len = h * (0.55 + Math.random() * 0.38);
    const droop = 0.5 + Math.random() * 0.5;
    const hue = 95 + Math.random() * 30, lit = 16 + Math.random() * 16;
    let px = ox, py = oy;
    for (let t = 0; t < 1; t += 0.045) {
      const x = ox + Math.cos(ang) * len * t + Math.sin(ang) * droop * 60 * t * t;
      const y = oy + Math.sin(ang) * len * t + droop * 60 * t * t;
      g.strokeStyle = `hsl(${hue}, 40%, ${lit - 4}%)`;
      g.lineWidth = 3 * (1 - t) + 0.6;
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      const leafLen = 26 * (1 - t * 0.8);
      for (const s of [-1, 1]) {
        g.save();
        g.translate(x, y);
        g.rotate(ang + s * 1.15);
        g.fillStyle = `hsla(${hue + 8}, 45%, ${lit + 6}%, 0.92)`;
        g.beginPath(); g.ellipse(leafLen / 2, 0, leafLen / 2, 3.4 * (1 - t * 0.6) + 0.8, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      px = x; py = y;
    }
  }
});

const barkTex = canvasTexture(256, (g, w, h) => {
  g.fillStyle = '#33261a';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * w;
    const lit = 8 + Math.random() * 18;
    g.strokeStyle = `hsla(${22 + Math.random() * 14}, ${20 + Math.random() * 18}%, ${lit}%, ${0.35 + Math.random() * 0.5})`;
    g.lineWidth = 1 + Math.random() * 3.5;
    g.beginPath();
    g.moveTo(x, -10);
    g.bezierCurveTo(x + (Math.random() - 0.5) * 26, h * 0.33, x + (Math.random() - 0.5) * 26, h * 0.66, x + (Math.random() - 0.5) * 18, h + 10);
    g.stroke();
  }
});
barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;

const treelineTex = canvasTexture(0, (g, w, h) => {
  g.clearRect(0, 0, w, h);

  // a depth layer of distinct tree crowns + trunk hints + sun highlights
  function layer(baseY, hScale, light, sat, count, blur) {
    g.save();
    if (blur) g.filter = `blur(${blur}px)`;
    for (let i = 0; i < count; i++) {
      const x = (i / count) * w + (Math.random() - 0.5) * (w / count) * 1.4;
      const tall = (44 + vnoise(x * 0.02 + baseY, baseY) * 175 + Math.random() * 34) * hScale;
      const cw = (9 + Math.random() * 17) * hScale;
      const hue = 92 + Math.random() * 32;
      // crown — a couple of overlapping blobs so it isn't a clean ellipse
      g.fillStyle = `hsla(${hue}, ${sat}%, ${light + Math.random() * 6}%, 1)`;
      for (let b = 0; b < 3; b++) {
        const bx = x + (Math.random() - 0.5) * cw, by = baseY - tall * (0.4 + Math.random() * 0.3);
        g.beginPath(); g.ellipse(bx, by, cw * (0.6 + Math.random() * 0.5), tall * (0.32 + Math.random() * 0.18), 0, 0, Math.PI * 2); g.fill();
      }
      // sun-side highlight (sun comes from the left)
      g.fillStyle = `hsla(${hue - 8}, ${sat}%, ${light + 16}%, 0.5)`;
      g.beginPath(); g.ellipse(x - cw * 0.35, baseY - tall * 0.62, cw * 0.5, tall * 0.3, 0, 0, Math.PI * 2); g.fill();
      // trunk hint
      g.fillStyle = `hsla(32, 16%, ${Math.max(4, light - 5)}%, 0.85)`;
      g.fillRect(x - 1.5 * hScale, baseY - tall * 0.18, 3 * hScale, tall * 0.2);
    }
    g.restore();
  }

  // back-to-front: far is light/desaturated/blurred (aerial perspective)
  layer(h * 0.90, 0.78, 26, 15, 64, 2.6);
  layer(h * 0.97, 1.0, 13, 24, 56, 1.1);
  layer(h * 1.03, 1.18, 6, 30, 46, 0);

  // soft mist pooling at the base of the trees
  const grad = g.createLinearGradient(0, h * 0.58, 0, h);
  grad.addColorStop(0, 'rgba(150,172,142,0)');
  grad.addColorStop(1, 'rgba(150,172,142,0.34)');
  g.fillStyle = grad; g.fillRect(0, h * 0.58, w, h * 0.42);

  // hanging canopy fringe along the top so the forest closes overhead
  g.save();
  g.filter = 'blur(1px)';
  for (let x = 0; x < w; x += 7) {
    const drop = 26 + vnoise(x * 0.04, 9.1) * 70 + Math.random() * 16;
    g.fillStyle = `hsla(${108 + Math.random() * 20}, 26%, ${5 + Math.random() * 4}%, 1)`;
    g.beginPath();
    g.ellipse(x, drop * 0.35, 10 + Math.random() * 16, drop * 0.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}, { w: 1024, h: 256 });

const glowSpriteTex = canvasTexture(64, (g, w) => {
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.35, 'rgba(255,250,210,0.45)');
  grad.addColorStop(1, 'rgba(255,245,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
});

const mistTex = canvasTexture(128, (g, w) => {
  // a gentle radial falloff with no hard ring — feathers softly to nothing
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0.0, 'rgba(235,242,228,0.42)');
  grad.addColorStop(0.4, 'rgba(228,238,220,0.17)');
  grad.addColorStop(0.7, 'rgba(223,234,215,0.05)');
  grad.addColorStop(1.0, 'rgba(220,232,212,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
});

// ------------------------------------------------------------
// Sky — open sky with soft, blurred, drifting clouds
// ------------------------------------------------------------
let skyMat;
{
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSunDir: { value: SUN_DIR }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uSunDir;
      uniform float uTime;
      ${GLSL_NOISE}
      // 5-octave fbm for detailed, billowy cloud density
      float cloudFbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * gnoise(p); p = p * 2.03 + 7.3; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 d = normalize(vDir);
        float hgt = clamp(d.y, 0.0, 1.0);
        float sd = max(dot(d, uSunDir), 0.0);
        // luminous misty overcast void — bright pale grey-green low, deeper grey up high
        vec3 low  = vec3(0.83, 0.86, 0.81);
        vec3 high = vec3(0.55, 0.62, 0.58);
        vec3 col = mix(low, high, smoothstep(-0.05, 0.75, hgt));
        // faint brightening where the hidden sun diffuses through the fog
        col += vec3(0.09, 0.09, 0.08) * pow(sd, 1.6) * (1.0 - smoothstep(0.0, 0.5, hgt));

        // soft drifting fog banks / overcast mottling (low contrast, billowy)
        vec2 cuv = d.xz / (d.y + 0.32);
        vec2 drift = vec2(uTime * 0.005, uTime * 0.002);
        float m = cloudFbm(cuv * 0.6 + drift) * 0.6 + cloudFbm(cuv * 1.5 - drift * 1.4) * 0.4;
        // darker wisps and brighter clearings, all desaturated grey-green
        col = mix(col, vec3(0.46, 0.52, 0.49), smoothstep(0.55, 0.78, m) * 0.5);
        col = mix(col, vec3(0.90, 0.92, 0.88), smoothstep(0.50, 0.30, m) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(80, 24, 16), skyMat));
}

// ------------------------------------------------------------
// Terrain — photographic grass + mossy vertex tinting, shadows
// ------------------------------------------------------------
const texLoader = new THREE.TextureLoader();
function loadTex(url) {
  const t = texLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// linear-space loader for normal maps (must NOT be sRGB)
function loadData(url) {
  const t = texLoader.load(url);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function tiled(t, rx, ry) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

{
  const groundDiff = tiled(loadTex('assets/textures/ground_diff.jpg'), 9, 9);
  const groundNor = tiled(loadData('assets/textures/ground_nor.jpg'), 9, 9);

  const SEG = 170, SIZE = 50;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    // green-dominant mossy tint so the earthy texture reads as grass, not dirt
    const m = vnoise(x * 0.8, z * 0.8), p = vnoise(x * 2.6 + 17, z * 2.6 + 5);
    let r = 0.32 + m * 0.18 + p * 0.08;
    let g = 0.62 + m * 0.34 + p * 0.12;
    let b = 0.24 + m * 0.12;
    const d = Math.abs(x - streamCenterX(z));
    const damp = 1 - smoothstep(0.7, 2.4, d);
    r *= 1 - damp * 0.35; g *= 1 - damp * 0.4; b *= 1 - damp * 0.45;   // wet earth darkens at the bank
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: groundDiff, normalMap: groundNor, normalScale: new THREE.Vector2(1.2, 1.2),
    vertexColors: true, roughness: 1.0, metalness: 0.0
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);
}

// ------------------------------------------------------------
// Moss grass — instanced blades with golden backlight
// ------------------------------------------------------------
const grassMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN_DIR } },
  vertexShader: `
    attribute vec3 aOffset;
    attribute float aScale;
    attribute float aRot;
    attribute float aShade;
    attribute float aLean;
    uniform float uTime;
    varying float vY;
    varying float vShade;
    varying vec3 vWorldPos;
    void main(){
      vY = uv.y;
      vShade = aShade;
      vec3 p = position;
      p.x *= 1.0 - uv.y * 0.9;                            // taper to a point
      p *= aScale;
      // gentle forward arch + wind sway, strongest toward the tip
      float wind = sin(uTime * 1.5 + aOffset.x * 0.7 + aOffset.z * 0.6 + aRot * 3.0);
      p.z += (aLean + 0.1 * wind) * uv.y * uv.y;
      float c = cos(aRot), s = sin(aRot);
      p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
      vec4 wp = modelMatrix * vec4(p + aOffset, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    varying float vY;
    varying float vShade;
    varying vec3 vWorldPos;
    uniform float uTime;
    uniform vec3 uSunDir;
    ${GLSL_NOISE}
    ${GLSL_FOG}
    void main(){
      // natural, slightly desaturated grass: olive-brown base -> muted green tip
      vec3 baseCol = vec3(0.050, 0.078, 0.034);
      vec3 midCol  = vec3(0.115, 0.185, 0.078);
      vec3 tipCol  = vec3(0.300, 0.380, 0.150);
      // per-blade variation: some blades cooler/deeper green, some drier/yellower
      tipCol = mix(tipCol, vec3(0.355, 0.360, 0.180), smoothstep(0.6, 1.0, vShade));   // sun-dried
      tipCol = mix(tipCol, vec3(0.205, 0.300, 0.130), smoothstep(0.4, 0.0, vShade));   // deep green
      midCol = mix(midCol, vec3(0.140, 0.160, 0.080), vShade);
      vec3 col = mix(baseCol, midCol, smoothstep(0.0, 0.5, vY));
      col = mix(col, tipCol, smoothstep(0.4, 1.0, vY));
      // ambient occlusion toward the soil
      col *= mix(0.5, 1.0, smoothstep(0.0, 0.45, vY));
      // large-scale lawn brightness variation so it isn't uniform
      float lawnVar = gfbm(vWorldPos.xz * 0.17);
      col *= 0.8 + lawnVar * 0.42;
      // soft drifting dappled light
      float dap = smoothstep(0.45, 0.85, gfbm(vWorldPos.xz * 0.4 + uTime * 0.012));
      col *= 0.85 + dap * 0.5;
      // subtle warm golden rim near the tips when backlit by the low sun
      vec3 toCamV = cameraPosition - vWorldPos;
      vec3 toCam = normalize(toCamV + vec3(0.0001));
      float back = pow(max(dot(toCam, -uSunDir), 0.0), 3.5);
      col += vec3(0.95, 0.52, 0.20) * back * smoothstep(0.55, 1.0, vY) * 0.42;
      gl_FragColor = vec4(applyFog(col, length(toCamV)), 1.0);
    }
  `
});
{
  const COUNT = IS_MOBILE ? 34000 : 100000;   // far fewer blades on phones
  const blade = new THREE.PlaneGeometry(0.05, 1, 1, IS_MOBILE ? 3 : 4);
  blade.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  geo.attributes.uv = blade.attributes.uv;

  const offsets = [], scales = [], rots = [], shades = [], leans = [];
  let placed = 0, guard = 0;
  while (placed < COUNT && guard++ < COUNT * 4) {
    const r = Math.sqrt(Math.random()) * 19;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 2;
    if (Math.abs(x - streamCenterX(z)) < 1.25) continue;        // keep the stream clear
    if (nearCard(x, z, 1.05)) continue;                         // no blades through the cards
    if (vnoise(x * 0.6 + 71, z * 0.6 + 23) < 0.20) continue;    // grow in clumps, but dense coverage
    const y = groundHeight(x, z);
    offsets.push(x, y - 0.02, z);
    scales.push(0.13 + Math.random() * 0.27);                   // taller, more varied
    rots.push(Math.random() * Math.PI * 2);
    shades.push(Math.random());
    leans.push(0.08 + Math.random() * 0.28);                    // base arch magnitude
    placed++;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
  geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
  geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(shades), 1));
  geo.setAttribute('aLean', new THREE.InstancedBufferAttribute(new Float32Array(leans), 1));
  geo.instanceCount = placed;
  const grass = new THREE.Mesh(geo, grassMat);
  grass.frustumCulled = false;
  scene.add(grass);
}

// ------------------------------------------------------------
// Ferns — crossed alpha-mapped fronds scattered on the banks
// ------------------------------------------------------------
{
  const fernMat = new THREE.MeshStandardMaterial({
    map: fernTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9
  });
  const group = new THREE.Group();
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.pow(Math.random(), 0.7) * 14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 2;
    if (Math.abs(x - streamCenterX(z)) < 1.7) continue;
    if (nearCard(x, z, 1.6)) continue;                  // fern fronds must not reach a card
    const s = 0.5 + Math.random() * 0.9;
    const y = groundHeight(x, z);
    const fern = new THREE.Group();
    for (let q = 0; q < 2; q++) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(s, s), fernMat);
      quad.position.y = s / 2 - 0.04;
      quad.rotation.y = q * Math.PI / 2 + Math.random() * 0.5;
      quad.castShadow = true;
      fern.add(quad);
    }
    fern.position.set(x, y, z);
    fern.rotation.y = Math.random() * Math.PI;
    group.add(fern);
  }
  scene.add(group);
}

// ------------------------------------------------------------
// Trees — two distinct trees on the left, a weeping willow on the right
// ------------------------------------------------------------
const swayMats = [];   // wind-animated materials (willow fronds), updated each frame
{
  const trunkMat = new THREE.MeshStandardMaterial({
    map: tiled(loadTex('assets/textures/bark_diff.jpg'), 1.6, 3),
    normalMap: tiled(loadData('assets/textures/bark_nor.jpg'), 1.6, 3),
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 1.0, color: 0x9ea08e   // cool, damp, weathered bark
  });

  // spreading surface roots that flare from the base and dive into the soil
  const _up = new THREE.Vector3(0, 1, 0);
  function addRoot(x, z, gy, baseR, ang, length, thick, rise) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const base = new THREE.Vector3(x + cs * baseR * 0.45, gy + rise, z + sn * baseR * 0.45);
    const tip = new THREE.Vector3(x + cs * length, gy - 0.06 - Math.random() * 0.14, z + sn * length);
    const dir = tip.clone().sub(base);
    const height = dir.length();
    dir.normalize();
    // thin tapering root that hugs the ground and slips into the soil
    const geo = new THREE.CylinderGeometry(thick * (0.1 + Math.random() * 0.12), thick, height, 5, 1);
    const root = new THREE.Mesh(geo, trunkMat);
    root.quaternion.setFromUnitVectors(_up, dir);
    root.position.copy(base).addScaledVector(dir, height / 2);
    root.castShadow = true;
    root.receiveShadow = true;
    scene.add(root);
  }
  function makeRoots(x, z, gy, baseR, seed) {
    const count = 4 + Math.floor(vnoise(seed * 1.7, seed) * 3);   // 4–6
    let ang = vnoise(seed, seed * 2.0) * Math.PI * 2;             // random start angle
    for (let i = 0; i < count; i++) {
      ang += 0.5 + Math.random() * 1.7;                          // uneven spacing → asymmetric
      const L = baseR * (1.2 + Math.random() * 1.5);            // shorter reach
      const thick = baseR * (0.14 + Math.random() * 0.16);     // thinner, varied
      const rise = baseR * (0.12 + Math.random() * 0.28);      // low buttress
      addRoot(x, z, gy, baseR, ang, L, thick, rise);
      // a thinner secondary rootlet forking off this one, sometimes
      if (Math.random() > 0.45) {
        addRoot(x, z, gy, baseR, ang + (Math.random() - 0.5) * 0.7, L * (0.55 + Math.random() * 0.4), thick * 0.5, rise * 0.5);
      }
    }
  }

  // a trunk that flares at the roots and can lean/curve as it rises
  function makeTrunk(t) {
    // high-poly trunk: dense rings + multi-octave bark relief and gnarl
    const geo = new THREE.CylinderGeometry(t.h * t.topR, t.h * t.botR, t.h, 28, 36);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x0 = p.getX(i), y = p.getY(i), z0 = p.getZ(i);
      const ty = Math.min(1, Math.max(0, (y + t.h / 2) / t.h));   // 0 base, 1 top (clamped)
      const ang = Math.atan2(z0, x0);
      const rad = Math.hypot(x0, z0) || 1e-4;
      const flare = 1 + Math.pow(Math.max(0, 0.13 - ty) / 0.13, 1.7) * 0.30;
      const wob = (vnoise(y * 0.8 + t.seed, t.z) - 0.5) * 0.22;
      // bark relief: broad vertical ridges + finer grain, eased out near the very top
      const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang));
      let relief = (vnoise(dir.x * 2.2 + t.seed, dir.y * 2.2 + y * 0.9) - 0.5) * 0.22;     // ridges
      relief += (vnoise(dir.x * 6.0 + t.seed * 2.0, dir.y * 6.0 + y * 3.0) - 0.5) * 0.09;  // fine grain
      relief *= (1.0 - ty * 0.4);
      const rr = rad * flare * (1 + wob) + relief;
      const lean = Math.pow(ty, 1.5);
      p.setX(i, Math.cos(ang) * rr + wob * 0.4 + (t.bend || 0) * lean);
      p.setZ(i, Math.sin(ang) * rr + (vnoise(y * 0.8 + 9 + t.seed, t.z) - 0.5) * 0.3 + (t.bendZ || 0) * lean);
    }
    // guard: never let a stray NaN reach the GPU (it would render as a black band)
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) p.array[i] = 0;
    geo.computeVertexNormals();
    const gy = groundHeight(t.x, t.z);
    const trunk = new THREE.Mesh(geo, trunkMat);
    trunk.position.set(t.x, gy + t.h / 2 - 0.45, t.z);   // sink the base into the moss
    // NB: no Y rotation — the lean stays aligned to world bend/bendZ so branches
    // (which start from the trunk centreline) attach exactly. Bark varies via seed.
    trunk.castShadow = true;
    scene.add(trunk);
    makeRoots(t.x, t.z, gy, t.h * t.botR * 1.15, t.seed);
    return gy;
  }

  // ---- moss-laden trees: gnarled twisting limbs, sparse leaf cover ----
  const leafCanopy = (col) => new THREE.MeshStandardMaterial({
    map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: col
  });
  // moss-covered branch material (bark texture, green mossy cast)
  const branchMat = new THREE.MeshStandardMaterial({
    map: tiled(loadTex('assets/textures/bark_diff.jpg'), 3, 3),
    normalMap: tiled(loadData('assets/textures/bark_nor.jpg'), 3, 3),
    normalScale: new THREE.Vector2(1.7, 1.7),
    roughness: 1.0, color: 0x7c8a56,
    side: THREE.DoubleSide        // no open tube end can ever read as a see-through gap
  });

  // ---- hanging swamp moss (Spanish-moss style) that drapes off the limbs ----
  const swampMossTex = canvasTexture(0, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const strands = 7;
    for (let s = 0; s < strands; s++) {
      const x0 = (s + 0.5) / strands * w + (Math.random() - 0.5) * 14;
      const curveAmt = (Math.random() - 0.5) * w * 0.22;
      const len = h * (0.7 + Math.random() * 0.3);
      const hue = 78 + Math.random() * 26;            // grey-green
      const sat = 12 + Math.random() * 16;            // low saturation = mossy, not neon
      let px = x0, py = 2;
      for (let ty = 0; ty < 1; ty += 0.025) {
        const yy = ty * len;
        const xx = x0 + curveAmt * ty * ty + Math.sin(ty * 18.0 + s) * 2.2;   // wispy waver
        g.strokeStyle = `hsla(${hue}, ${sat}%, ${28 + Math.random() * 16}%, 0.9)`;
        g.lineWidth = 1.6 * (1 - ty) + 0.5;
        g.beginPath(); g.moveTo(px, py); g.lineTo(xx, yy); g.stroke();
        if (Math.random() > 0.42) {                   // little hanging tufts
          const ll = 5 * (1 - ty * 0.4) + 2;
          g.fillStyle = `hsla(${hue + 5}, ${sat + 8}%, ${32 + Math.random() * 14}%, 0.85)`;
          g.beginPath(); g.ellipse(xx, yy, ll * 0.4, 1.3, 0, 0, Math.PI * 2); g.fill();
        }
        px = xx; py = yy;
      }
    }
  }, { w: 96, h: 320 });
  // sways each strand's dangling tip; world-space positions are baked, sway phase
  // is a per-strand attribute so all strands can merge into one mesh.
  const mossDrapeMat = new THREE.ShaderMaterial({
    transparent: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uMap: { value: swampMossTex }, uSunDir: { value: SUN_DIR } },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main(){
        vUv = uv;
        vec3 p = position;                         // already world-space (baked)
        float droop = pow(1.0 - uv.y, 1.6);        // 0 at the attached top, 1 at the tip
        float sway = sin(uTime * 0.8 + aPhase) * 0.22 + sin(uTime * 1.7 + aPhase * 1.6) * 0.08;
        p.x += sway * droop;
        p.z += cos(uTime * 0.6 + aPhase) * 0.10 * droop;
        vWorldPos = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      ${GLSL_FOG}
      void main(){
        vec4 tx = texture2D(uMap, vUv);
        if (tx.a < 0.4) discard;
        gl_FragColor = vec4(applyFog(tx.rgb, length(vWorldPos - cameraPosition)), 1.0);
      }
    `
  });
  swayMats.push(mossDrapeMat);
  const _mossMat4 = new THREE.Matrix4(), _mossQ = new THREE.Quaternion(), _mossE = new THREE.Euler(),
        _mossP = new THREE.Vector3(), _mossS = new THREE.Vector3();

  // build one tapered, twisting limb as a world-space tube geometry; returns { geo, tip, pts }
  function limbGeometry(start, ang, elev, length, radius, seed) {
    const pts = [start.clone()];
    let p = start.clone();
    let dir = new THREE.Vector3(Math.cos(ang), elev, Math.sin(ang)).normalize();
    const segs = 6;
    for (let i = 1; i <= segs; i++) {
      p = p.clone().addScaledVector(dir, length / segs);
      // never let a limb dip into the ground or the stream
      const minY = Math.max(groundHeight(p.x, p.z), WATER_Y) + 0.5;
      if (p.y < minY) p.y = minY;
      pts.push(p.clone());
      dir = dir.clone();
      dir.x += (vnoise(seed + i * 3.1, seed) - 0.5) * 0.9;
      dir.y += (vnoise(seed + i * 2.3 + 11, seed) - 0.5) * 0.7 + 0.01;   // gnarl, gentle, no droop bias
      dir.z += (vnoise(seed + i * 1.7 + 23, seed) - 0.5) * 0.9;
      // smoothly steer limbs that reach toward the camera back & up — keeps the
      // card's lift zone clear without the hard flat cut a z-clamp produced
      if (p.z > 0.0) { dir.z -= p.z * 0.22; dir.y += p.z * 0.06; }
      dir.normalize();
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const thick = radius > 0.06;                       // thicker limbs get rounder, denser tubes
    const tubSeg = thick ? 30 : 18;
    const radSeg = thick ? 11 : 8;
    const geo = new THREE.TubeGeometry(curve, tubSeg, radius, radSeg, false);
    // taper the radius from base → tip, and gnarl the surface with multi-octave
    // bark relief so the limb reads as detailed bark rather than a smooth tube
    const pos = geo.attributes.position;
    const ringVerts = radSeg + 1;
    const centers = [];
    for (let r = 0; r <= tubSeg; r++) centers.push(curve.getPointAt(r / tubSeg));
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.min(tubSeg, Math.floor(i / ringVerts));
      const c = centers[ring];
      // taper, then pinch the very last ring nearly to the centreline so the
      // tube tip closes to a point instead of an open, see-through hole
      const taper = (1 - (ring / tubSeg) * 0.68) * (ring === tubSeg ? 0.04 : 1);
      let ox = (pos.getX(i) - c.x) * taper;
      let oy = (pos.getY(i) - c.y) * taper;
      let oz = (pos.getZ(i) - c.z) * taper;
      const wx = c.x + ox, wy = c.y + oy, wz = c.z + oz;
      let relief = (vnoise(wx * 5.0 + seed, wz * 5.0 + wy * 4.0) - 0.5);          // ridges
      relief += (vnoise(wx * 13.0 + seed * 2.0, wz * 13.0 + wy * 9.0) - 0.5) * 0.45; // fine grain
      const sc = 1.0 + relief * (thick ? 0.26 : 0.16);
      pos.setX(i, c.x + ox * sc);
      pos.setY(i, c.y + oy * sc);
      pos.setZ(i, c.z + oz * sc);
    }
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) pos.array[i] = 0;
    geo.computeVertexNormals();
    return { geo, tip: pts[pts.length - 1], pts };
  }

  const TREE_H = IS_MOBILE ? 1.5 : 1;   // taller trunks reach up the portrait frame on mobile
  function makeBroadleaf(t) {
    t.h *= TREE_H;
    const gy = makeTrunk(t);
    const limbGeos = [];
    const leafAnchors = [];
    const mossAnchors = [];
    // recursively grow a limb and its children (fractal branching → high detail)
    function grow(start, ang, elev, length, radius, seed, depth) {
      const { geo, tip, pts } = limbGeometry(start, ang, elev, length, radius, seed);
      limbGeos.push(geo);
      // points ALONG this limb (skip the trunk-attached base) become moss hang-points
      for (let pi = 2; pi < pts.length; pi++) mossAnchors.push(pts[pi]);
      if (depth <= 0 || radius < 0.018) { leafAnchors.push(tip); return; }
      // knuckle: a solid sphere at the fork fills any seam where the child limbs
      // sprout from this limb's tip, so a junction can never read as a gap
      const knuckle = new THREE.SphereGeometry(radius * 0.7, 8, 6);
      knuckle.translate(tip.x, tip.y, tip.z);
      limbGeos.push(knuckle);
      const n = depth >= 2 ? 2 + (Math.random() * 2 | 0) : 1 + (Math.random() * 2 | 0);
      for (let k = 0; k < n; k++) {
        grow(
          tip,
          ang + (Math.random() - 0.5) * 1.7,
          elev + (Math.random() - 0.5) * 0.5 + 0.04,
          length * (0.55 + Math.random() * 0.22),
          radius * (0.52 + Math.random() * 0.16),
          seed + k * 31.7 + depth * 7.3,
          depth - 1
        );
      }
    }
    // primary limbs branch low off the trunk and twist across the view
    const nb = 6 + (Math.random() * 3 | 0);
    for (let i = 0; i < nb; i++) {
      const sh = 0.34 + Math.random() * 0.42;                  // start height fraction along trunk
      // match the trunk's actual leaned, sunk centreline so the limb attaches
      const lean = Math.pow(sh, 1.5);
      const start = new THREE.Vector3(
        t.x + (t.bend || 0) * lean,
        gy + t.h * sh - 0.45,
        t.z + (t.bendZ || 0) * lean
      );
      const ang = (i / nb) * Math.PI * 2 + Math.random() * 0.7;
      const elev = 0.05 + Math.random() * 0.4;                 // out & up, never starting downward
      const len = t.h * (0.42 + Math.random() * 0.46);
      const rad = t.h * (0.02 + Math.random() * 0.014);
      grow(start, ang, elev, len, rad, t.seed + i * 13.7, 3);
    }
    // merge every limb/twig into a single mesh (hundreds of polys, one draw call)
    if (limbGeos.length) {
      const merged = mergeGeometries(limbGeos, false);
      const m = new THREE.Mesh(merged, branchMat);
      m.castShadow = true;
      scene.add(m);
      limbGeos.forEach((g) => g.dispose());
    }

    // (no leaf globs — the limbs are clothed entirely in hanging swamp moss)

    // swamp moss draping straight down off the limbs (crossed alpha quads, merged)
    const mossGeos = [];
    const nMoss = Math.min(mossAnchors.length, Math.round(t.h * 26));   // dense, mossy limbs
    for (let c = 0; c < nMoss; c++) {
      const a = mossAnchors[(Math.random() * mossAnchors.length) | 0];
      if (a.y < gy + 1.0) continue;                       // only from limbs above the ground
      const len = 0.35 + Math.random() * 1.9;
      const w = 0.15 + Math.random() * 0.28;
      const phase = a.x * 0.7 + a.z * 0.9 + c * 0.27;
      for (let q = 0; q < 2; q++) {                       // crossed quads for volume
        const g = new THREE.PlaneGeometry(w, 1, 1, 6);
        g.translate(0, -0.5, 0);                          // top at the limb, hangs down to -1
        _mossE.set((Math.random() - 0.5) * 0.3, q * Math.PI / 2 + Math.random() * 0.6, 0);
        _mossQ.setFromEuler(_mossE);
        _mossP.set(a.x + (Math.random() - 0.5) * 0.18, a.y + 0.05, a.z + (Math.random() - 0.5) * 0.18);
        _mossS.set(1, len, 1);
        g.applyMatrix4(_mossMat4.compose(_mossP, _mossQ, _mossS));
        const ph = new Float32Array(g.attributes.position.count).fill(phase);
        g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        mossGeos.push(g);
      }
    }
    if (mossGeos.length) {
      scene.add(new THREE.Mesh(mergeGeometries(mossGeos, false), mossDrapeMat));
      mossGeos.forEach((g) => g.dispose());
    }
  }

  // Tree 1 — stout, gnarled ancient oak, low twisting limbs
  makeBroadleaf({ x: -6.2, z: -7.0, h: 6.8, topR: 0.05, botR: 0.11, bend: 0.5, bendZ: 0.3, seed: 12.3,
    clusters: 5, canopyScale: 0.34, spread: 0.5, canopyY: 0.62, canopyCol: 0x7e8c5a });
  // Tree 2 — set back and to the left, shorter, leaning in, nearly bare
  makeBroadleaf({ x: -9.2, z: -8.6, h: 5.8, topR: 0.055, botR: 0.12, bend: 1.0, bendZ: 0.3, seed: 47.1,
    clusters: 4, canopyScale: 0.32, spread: 0.55, canopyY: 0.6, canopyCol: 0x86905a });
  // Tree 3 — a gnarled sentinel mid-left, deeper in the fog
  makeBroadleaf({ x: -2.6, z: -10.5, h: 6.4, topR: 0.05, botR: 0.11, bend: -0.5, bendZ: -0.4, seed: 71.5,
    clusters: 4, canopyScale: 0.32, spread: 0.5, canopyY: 0.6, canopyCol: 0x7c8858 });
  // Tree 4 — a low arching oak on the near right, limbs reaching over the stream
  makeBroadleaf({ x: 4.6, z: -8.2, h: 6.0, topR: 0.055, botR: 0.12, bend: -1.2, bendZ: 0.4, seed: 33.8,
    clusters: 4, canopyScale: 0.32, spread: 0.55, canopyY: 0.6, canopyCol: 0x808c5a });

  // ---- WEEPING WILLOW on the RIGHT ----
  (function makeWillow() {
    const wx = 7.4, wz = -6.6, wh = 8.0 * TREE_H;
    const gy = makeTrunk({ x: wx, z: wz, h: wh, topR: 0.026, botR: 0.072, bend: 1.4, bendZ: -0.3, seed: 88.0 });
    const crownX = wx + 1.2;             // crown rides the trunk's lean
    const crownZ = wz + 0.3;
    const crownY = gy + wh * 0.74;       // lower crown so the curtain cascades into view
    const crownR = 3.6;

    // rounded crown cap on top so the willow isn't bald
    const capMat = new THREE.MeshStandardMaterial({
      map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0x9aa566
    });
    for (let c = 0; c < 6; c++) {
      const cs = wh * (0.42 + Math.random() * 0.22);
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(cs, cs), capMat);
      const ang = Math.random() * Math.PI * 2, rr = Math.random() * crownR * 0.7;
      cl.position.set(crownX + Math.cos(ang) * rr, crownY + 0.6 + Math.random() * 0.8, crownZ + Math.sin(ang) * rr);
      cl.rotation.set((Math.random() - 0.5) * 0.8, Math.random() * Math.PI, (Math.random() - 0.5) * 0.8);
      cl.castShadow = true;
      scene.add(cl);
    }

    // a hanging-leaf curtain texture (several drooping leaf strands)
    const willowTex = canvasTexture(0, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const strands = 9;
      for (let s = 0; s < strands; s++) {
        const x0 = (s + 0.5) / strands * w + (Math.random() - 0.5) * 12;
        const curve = (Math.random() - 0.5) * w * 0.3;
        const len = h * (0.74 + Math.random() * 0.26);
        const hue = 66 + Math.random() * 22;
        let px = x0, py = 2;
        for (let ty = 0; ty < 1; ty += 0.03) {
          const yy = ty * len;
          const xx = x0 + curve * ty * ty;
          g.strokeStyle = `hsla(${hue}, 32%, ${26 + Math.random() * 12}%, 0.94)`;
          g.lineWidth = 2.0 * (1 - ty) + 0.6;
          g.beginPath(); g.moveTo(px, py); g.lineTo(xx, yy); g.stroke();
          if (Math.random() > 0.18) {
            const ll = 9 * (1 - ty * 0.5) + 3;
            const side = Math.random() > 0.5 ? 1 : -1;
            g.save(); g.translate(xx, yy); g.rotate(side * 0.4 + 1.5);
            g.fillStyle = `hsla(${hue + 6}, 36%, ${30 + Math.random() * 12}%, 0.94)`;
            g.beginPath(); g.ellipse(ll * 0.5, 0, ll * 0.5, 1.7, 0, 0, Math.PI * 2); g.fill();
            g.restore();
          }
          px = xx; py = yy;
        }
      }
    }, { w: 96, h: 320 });

    // frond material — sways the dangling tips in the wind, golden backlight
    const willowMat = new THREE.ShaderMaterial({
      transparent: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uMap: { value: willowTex }, uSunDir: { value: SUN_DIR } },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main(){
          vUv = uv;
          vec3 p = position;
          float droop = pow(1.0 - uv.y, 1.6);            // 0 attached (top), 1 at the dangling tip
          vec3 anchor = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float ph = anchor.x * 0.7 + anchor.z * 0.9;
          float sway = sin(uTime * 1.05 + ph) * 0.38 + sin(uTime * 2.2 + ph * 1.7) * 0.13;
          p.x += sway * droop;
          p.z += cos(uTime * 0.85 + ph) * 0.14 * droop;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        ${GLSL_FOG}
        void main(){
          vec4 tx = texture2D(uMap, vUv);
          if (tx.a < 0.35) discard;
          vec3 col = tx.rgb;
          // desaturate & deepen so the fronds read as muted foliage, not neon
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, 0.7) * 0.82;
          vec3 toCam = normalize(cameraPosition - vWorldPos);
          float back = pow(max(dot(toCam, -uSunDir), 0.0), 2.0);
          col += vec3(1.0, 0.80, 0.42) * back * 0.40;     // warm sun glowing through the leaves
          float depth = length(vWorldPos - cameraPosition);
          gl_FragColor = vec4(applyFog(col, depth), 1.0);
        }
      `
    });
    swayMats.push(willowMat);

    // single frond geo: top edge at y=0, hangs down to y=-1 (uv.y 1=top, 0=tip)
    const frondGeo = new THREE.PlaneGeometry(0.6, 1, 1, 6);
    frondGeo.translate(0, -0.5, 0);
    const FRONDS = 95;
    const faceCam = -0.5;   // orient the curtain toward the camera / glade
    for (let i = 0; i < FRONDS; i++) {
      // bias placement to the glade-facing side, with some all-round fill for volume
      const ang = (Math.random() < 0.7)
        ? Math.PI * 0.45 + Math.random() * Math.PI * 0.7
        : Math.random() * Math.PI * 2;
      const rr = crownR * (0.3 + Math.random() * 0.7);
      const ax = crownX + Math.cos(ang) * rr;
      const az = crownZ + Math.sin(ang) * rr;
      const ay = crownY + 0.5 - (rr / crownR) * 1.2;   // attach lower toward the crown's edge (dome)
      const len = 3.2 + Math.random() * 2.6;
      const fr = new THREE.Mesh(frondGeo, willowMat);
      fr.position.set(ax, ay, az);
      fr.scale.set(0.7 + Math.random() * 0.8, len, 1);
      fr.rotation.y = faceCam + (Math.random() - 0.5) * 1.5;   // mostly facing camera, fanned out
      fr.rotation.x = (Math.random() - 0.5) * 0.18;
      scene.add(fr);
    }
  })();

  // (background treeline, distant tree row and overhead canopy ceiling removed —
  // the backdrop is now open sky with drifting clouds)
}

// ------------------------------------------------------------
// The stream — real reflective water
// ------------------------------------------------------------
let water;
{
  const verts = [], uvs = [], idx = [];
  const Z0 = -20, Z1 = 9.5, STEPS = 100, HALF = 1.05;
  for (let i = 0; i <= STEPS; i++) {
    const z = Z0 + (Z1 - Z0) * (i / STEPS);
    const c = streamCenterX(z);
    verts.push(c - HALF, 0, z, c + HALF, 0, z);
    uvs.push(0, i / STEPS, 1, i / STEPS);
  }
  for (let i = 0; i < STEPS; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);   // wound to face upward
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const waterNormals = texLoader.load('assets/textures/waternormals.jpg');
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

  water = new Water(geo, {
    textureWidth: IS_MOBILE ? 256 : 512,
    textureHeight: IS_MOBILE ? 256 : 512,
    waterNormals,
    sunDirection: SUN_DIR.clone(),
    sunColor: 0xffc27a,
    waterColor: 0x16281c,
    distortionScale: 3.4,
    fog: true
  });
  water.position.y = WATER_Y;
  scene.add(water);

  // deep teal tint multiplied over the reflection so it reads as
  // forest water rather than a pale mirror of the sky
  const tint = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
    color: 0x7da393,
    blending: THREE.MultiplyBlending,
    transparent: true,
    depthWrite: false
  }));
  tint.position.y = WATER_Y + 0.006;
  scene.add(tint);
}

// foam ribbons hugging each bank
const foamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    ${GLSL_NOISE}
    void main(){
      float flow = vUv.y * 60.0 - uTime * 2.0;
      float n = gfbm(vec2(vUv.x * 2.0, flow));
      // feather the strip's ends (vUv.y) too so the foam fades in/out, no hard cap
      float a = smoothstep(0.35, 0.75, n) * 0.45 * smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x)
              * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
      gl_FragColor = vec4(0.88, 0.94, 0.88, a);
    }
  `
});
{
  for (const side of [-1, 1]) {
    const verts = [], uvs = [], idx = [];
    const Z0 = -20, Z1 = 9.5, STEPS = 100, W = 0.16;
    for (let i = 0; i <= STEPS; i++) {
      const z = Z0 + (Z1 - Z0) * (i / STEPS);
      const c = streamCenterX(z) + side * 0.97;
      verts.push(c - W / 2, WATER_Y + 0.012, z, c + W / 2, WATER_Y + 0.012, z);
      uvs.push(0, i / STEPS, 1, i / STEPS);
    }
    for (let i = 0; i < STEPS; i++) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    scene.add(new THREE.Mesh(geo, foamMat));
  }
}

// ------------------------------------------------------------
// Mossy rocks — noise-displaced geometry + photographic moss
// ------------------------------------------------------------
const mossRockMat = new THREE.MeshStandardMaterial({
  map: tiled(loadTex('assets/textures/rock_diff.jpg'), 1.4, 1.4),
  normalMap: tiled(loadData('assets/textures/rock_nor.jpg'), 1.4, 1.4),
  normalScale: new THREE.Vector2(1.3, 1.3),
  roughness: 1.0, color: 0x8c9772   // damp, mossy grey-green cast
});
function makeRockGeo(s, seed) {
  const geo = new THREE.IcosahedronGeometry(s, 2);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = vnoise(v.x * 2.2 + seed, v.z * 2.2 + v.y * 1.7 + seed * 1.3);
    v.multiplyScalar(1 + (n - 0.5) * 0.55);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------
// Waterfall — backlit cascade, rocks, rising mist
// ------------------------------------------------------------
const fallMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uSpeed: { value: 2.4 } },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    uniform float uTime;
    uniform float uSpeed;
    ${GLSL_NOISE}
    ${GLSL_FOG}
    void main(){
      float fall = gfbm(vec2(vUv.x * 8.0, vUv.y * 2.5 + uTime * uSpeed));
      float streaks = smoothstep(0.32, 0.85, fall);
      vec3 col = mix(vec3(0.75, 0.84, 0.80), vec3(0.98, 1.0, 0.97), streaks);
      // feather all four edges so the cascade blends rather than ending in a hard line
      float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x)
                 * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.80, vUv.y);
      float a = (0.28 + streaks * 0.45) * edge;
      float depth = length(vWorldPos - cameraPosition);
      gl_FragColor = vec4(applyFog(col, depth), a);
    }
  `
});
const mistSprites = [];
{
  const fz = -12.6;
  const fx = streamCenterX(fz);

  for (const [w, h, dy, dz, sp] of [[1.9, 1.25, 0.45, 0, 2.4], [1.5, 1.05, 0.4, 0.18, 3.1]]) {
    const m = fallMat.clone();
    m.uniforms.uSpeed.value = sp;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    fall.position.set(fx, WATER_Y + dy, fz + dz);
    scene.add(fall);
    mistSprites.push({ mesh: null, mat: m });   // track for uTime updates
  }

  for (let i = 0; i < 9; i++) {
    const s = 0.5 + Math.random() * 0.45;
    const r = new THREE.Mesh(makeRockGeo(s, i * 7.3), mossRockMat);
    r.position.set(fx - 2.0 + i * 0.55 + (Math.random() - 0.5) * 0.3, WATER_Y + 1.25 + (Math.random() - 0.5) * 0.3, fz - 0.5 + (Math.random() - 0.5) * 0.6);
    r.scale.y = 0.65;
    r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    r.castShadow = true;
    scene.add(r);
  }

  // rising mist at the base + a couple of drifting wisps over the stream
  for (let i = 0; i < 10; i++) {
    const sm = new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0.22, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    const overStream = i > 6;
    const z = overStream ? -4 - Math.random() * 5 : fz + 0.4 + Math.random() * 0.5;
    sp.position.set(streamCenterX(z) + (Math.random() - 0.5) * 1.2, WATER_Y + 0.3, z);
    sp.scale.setScalar(overStream ? 3.2 : 1.6);
    sp.userData = { phase: Math.random() * Math.PI * 2, speed: 0.14 + Math.random() * 0.12, baseY: WATER_Y + 0.25, rise: overStream ? 0.4 : 1.1 };
    scene.add(sp);
    mistSprites.push({ mesh: sp, mat: null });
  }
}

// ------------------------------------------------------------
// God rays — volumetric light shafts through the canopy
// ------------------------------------------------------------
const beamMats = [];
{
  const beamMat = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.05 } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uIntensity;
      void main(){
        float along = vUv.y;
        float edge = sin(vUv.x * 3.14159);
        float shimmer = 0.8 + 0.2 * sin(uTime * 0.6 + vUv.x * 9.0);
        float a = pow(along, 1.6) * edge * uIntensity * shimmer;
        gl_FragColor = vec4(1.0, 0.88, 0.62, a);
      }
    `
  });
  const beamDefs = [
    { x: -3.5, z: -7, r: 1.2, len: 8, tilt: 0.12, i: 0.12 },
    { x: 0.5, z: -9.5, r: 1.6, len: 9, tilt: 0.05, i: 0.10 },
    { x: 3.2, z: -5, r: 1.0, len: 7, tilt: 0.18, i: 0.085 },
    { x: -1.2, z: -3, r: 0.7, len: 7, tilt: 0.22, i: 0.07 },
    { x: 5.5, z: -10, r: 1.8, len: 9, tilt: 0.0, i: 0.08 }
  ];
  beamDefs.forEach(b => {
    const m = beamMat();
    m.uniforms.uIntensity.value = b.i;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.55, b.r, b.len, 12, 1, true), m);
    cone.position.set(b.x, 2.9, b.z);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN_DIR.clone().setLength(1));
    cone.rotateX(b.tilt);
    scene.add(cone);
    beamMats.push(m);
  });
}

// ------------------------------------------------------------
// Rocks, moss cushions, bioluminescent accents
// ------------------------------------------------------------
const bioPulse = [];
{
  for (let i = 0; i < 16; i++) {
    const z = -11 + i * 1.35 + (Math.random() - 0.5);
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = streamCenterX(z) + side * (1.25 + Math.random() * 0.9);
    const s = 0.14 + Math.random() * 0.3;
    if (nearCard(x, z, 1.3 + s)) continue;
    const rock = new THREE.Mesh(makeRockGeo(s, i * 3.1 + 40), mossRockMat);
    rock.position.set(x, groundHeight(x, z) + s * 0.3, z);
    rock.scale.y = 0.6 + Math.random() * 0.3;
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    // small bioluminescent growths sheltering beside some rocks
    if (Math.random() > 0.5) {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x224437, emissive: 0x5fe8c0, emissiveIntensity: 1.6, roughness: 0.6 })
      );
      glow.position.set(x + (Math.random() - 0.5) * 0.5, groundHeight(x, z) + 0.05, z + (Math.random() - 0.5) * 0.5);
      scene.add(glow);
      bioPulse.push({ mesh: glow, phase: Math.random() * Math.PI * 2 });
    }
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 2;
    if (Math.abs(x - streamCenterX(z)) < 1.6) continue;
    const s = 0.18 + Math.random() * 0.4;
    if (nearCard(x, z, 1.3 + s)) continue;
    const cushion = new THREE.Mesh(makeRockGeo(s, i * 5.7 + 90), mossRockMat);
    cushion.position.set(x, groundHeight(x, z) - s * 0.15, z);
    cushion.scale.y = 0.5;
    cushion.receiveShadow = true;
    cushion.castShadow = true;
    scene.add(cushion);
  }
}

// ------------------------------------------------------------
// Forest detail layer — litter, flowers, mushrooms, pebbles,
// floating leaves, lily pads, butterflies, bank mist
// ------------------------------------------------------------
const animatedExtras = [];   // each: (t, dt) => void, called every frame

// scatter `count` points on the ground, skipping the stream channel
function scatter(count, rMax, minStreamDist, cb) {
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 6) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * rMax;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr - 2;
    if (Math.abs(x - streamCenterX(z)) < minStreamDist) continue;
    if (nearCard(x, z, 1.05)) continue;                 // keep flowers/ground detail off the cards
    cb(x, z, placed); placed++;
  }
  return placed;
}

// single-leaf sprite (ground litter + drifting leaves)
const oneLeafTex = canvasTexture(128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.translate(w / 2, h / 2);
  g.fillStyle = '#7c9440';
  g.beginPath();
  g.moveTo(0, -h * 0.42);
  g.bezierCurveTo(w * 0.34, -h * 0.18, w * 0.30, h * 0.22, 0, h * 0.42);
  g.bezierCurveTo(-w * 0.30, h * 0.22, -w * 0.34, -h * 0.18, 0, -h * 0.42);
  g.fill();
  g.strokeStyle = 'rgba(38,52,18,0.55)'; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(0, -h * 0.38); g.lineTo(0, h * 0.38); g.stroke();
  for (let k = 1; k <= 3; k++) {
    const yy = -h * 0.38 + (h * 0.76) * (k / 4);
    g.beginPath(); g.moveTo(0, yy); g.lineTo(w * 0.18, yy + h * 0.07); g.stroke();
    g.beginPath(); g.moveTo(0, yy); g.lineTo(-w * 0.18, yy + h * 0.07); g.stroke();
  }
});

// tiny 5-petal flower
const flowerTex = canvasTexture(64, (g, w) => {
  g.clearRect(0, 0, w, w);
  g.translate(w / 2, w / 2);
  for (let k = 0; k < 5; k++) {
    g.rotate(Math.PI * 2 / 5);
    g.fillStyle = 'rgba(255,252,248,0.97)';
    g.beginPath(); g.ellipse(0, -w * 0.27, w * 0.13, w * 0.21, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#eab63c';
  g.beginPath(); g.arc(0, 0, w * 0.13, 0, Math.PI * 2); g.fill();
});

// butterfly wing (right wing; left is mirrored) — monarch-like, higher detail
const wingTex = canvasTexture(128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  // forewing + hindwing lobes
  const lobes = [[w * 0.46, h * 0.32, w * 0.42, h * 0.26], [w * 0.40, h * 0.68, w * 0.35, h * 0.24]];
  // dark outer membrane
  g.fillStyle = '#2a1608';
  for (const [cx, cy, rx, ry] of lobes) { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  // orange inner panels (inset from the dark border)
  g.fillStyle = '#e07a1f';
  for (const [cx, cy, rx, ry] of lobes) { g.beginPath(); g.ellipse(cx, cy, rx * 0.82, ry * 0.8, 0, 0, Math.PI * 2); g.fill(); }
  // black veins fanning from the wing root
  g.strokeStyle = 'rgba(26,14,6,0.85)'; g.lineWidth = 2.4;
  for (let k = 0; k < 6; k++) {
    const ang = -0.5 + k * 0.32;
    g.beginPath(); g.moveTo(w * 0.06, h * 0.5);
    g.lineTo(w * 0.06 + Math.cos(ang) * w * 0.8, h * 0.5 + Math.sin(ang) * h * 0.42); g.stroke();
  }
  // white spots along the dark border
  g.fillStyle = 'rgba(255,250,238,0.95)';
  for (const [cx, cy, rx, ry] of lobes) {
    for (let k = 0; k < 5; k++) {
      const a = -0.6 + k * 0.5;
      g.beginPath(); g.arc(cx + Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.92, w * 0.018, 0, 6.28); g.fill();
    }
  }
});

const _im = new THREE.Matrix4(), _iq = new THREE.Quaternion(), _ie = new THREE.Euler(),
      _ip = new THREE.Vector3(), _is = new THREE.Vector3(), _ic = new THREE.Color();

// ---- fallen-leaf litter (instanced, tinted browns & greens) ----
{
  const geo = new THREE.PlaneGeometry(0.2, 0.13); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: oneLeafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1.0 });
  const N = 1700;
  const im = new THREE.InstancedMesh(geo, mat, N);
  im.receiveShadow = true; im.frustumCulled = false;
  const tints = [0x8a6a2e, 0x6f8a3a, 0xa8702f, 0x5d4a22, 0x7c5a25, 0x4e6a26];
  let i = 0;
  scatter(N, 17, 1.2, (x, z) => {
    const gy = groundHeight(x, z);
    const sc = 0.6 + Math.random() * 1.2;
    _ie.set((Math.random() - 0.5) * 0.45, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.45);
    _iq.setFromEuler(_ie); _ip.set(x, gy + 0.012, z); _is.set(sc, sc, sc);
    _im.compose(_ip, _iq, _is); im.setMatrixAt(i, _im);
    _ic.setHex(tints[(Math.random() * tints.length) | 0]).multiplyScalar(0.8 + Math.random() * 0.5);
    im.setColorAt(i, _ic); i++;
  });
  im.count = i; im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im);
}

// ---- wildflowers (clustered, instanced, upright) ----
{
  const geo = new THREE.PlaneGeometry(0.17, 0.17);
  const mat = new THREE.MeshStandardMaterial({
    map: flowerTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8,
    emissive: 0xffffff, emissiveMap: flowerTex, emissiveIntensity: 0.08
  });
  const N = 640;
  const im = new THREE.InstancedMesh(geo, mat, N);
  im.frustumCulled = false;
  const tints = [0xffffff, 0xf3e6a8, 0xf2c2d4, 0xd0d2f2, 0xffffff, 0xfff0bc];
  let i = 0;
  // ~74 clusters, several blooms each
  scatter(74, 16, 1.6, (cx, cz) => {
    const blooms = 5 + (Math.random() * 6 | 0);
    for (let b = 0; b < blooms && i < N; b++) {
      const x = cx + (Math.random() - 0.5) * 0.7, z = cz + (Math.random() - 0.5) * 0.7;
      if (Math.abs(x - streamCenterX(z)) < 1.4) continue;
      const gy = groundHeight(x, z);
      const sc = 0.7 + Math.random() * 0.7;
      _ie.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
      _iq.setFromEuler(_ie); _ip.set(x, gy + 0.085 * sc, z); _is.set(sc, sc, sc);
      _im.compose(_ip, _iq, _is); im.setMatrixAt(i, _im);
      _ic.setHex(tints[(Math.random() * tints.length) | 0]);
      im.setColorAt(i, _ic); i++;
    }
  });
  im.count = i; im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im);
}

// ---- scattered pebbles (instanced, denser near the banks) ----
{
  const geo = new THREE.IcosahedronGeometry(0.05, 1);
  const N = 440;
  const im = new THREE.InstancedMesh(geo, mossRockMat, N);
  im.receiveShadow = true; im.frustumCulled = false;
  let i = 0;
  const place = (x, z) => {
    const gy = groundHeight(x, z);
    const sc = 0.5 + Math.random() * 1.5;
    _ie.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    _iq.setFromEuler(_ie); _ip.set(x, gy + 0.02 * sc, z); _is.set(sc, sc * 0.7, sc);
    _im.compose(_ip, _iq, _is); im.setMatrixAt(i, _im); i++;
  };
  // half hugging the stream banks
  for (let k = 0; k < N / 2; k++) {
    const z = -16 + Math.random() * 24, side = Math.random() > 0.5 ? 1 : -1;
    place(streamCenterX(z) + side * (1.05 + Math.random() * 0.7), z);
  }
  scatter(N - i, 16, 1.25, (x, z) => place(x, z));
  im.count = i; im.instanceMatrix.needsUpdate = true;
  scene.add(im);
}

// ---- leaves drifting down the stream ----
{
  const geo = new THREE.PlaneGeometry(0.16, 0.11); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: oneLeafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: 0x9fb866 });
  const leaves = [];
  for (let i = 0; i < 26; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    leaves.push({ mesh, z: -16 + Math.random() * 25, off: (Math.random() - 0.5) * 1.5, spd: 0.45 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 0.7, ph: Math.random() * 6.28 });
  }
  animatedExtras.push((t, dt) => {
    for (const o of leaves) {
      o.z += o.spd * dt;                 // drift toward the viewer (downstream)
      if (o.z > 9.4) { o.z = -16; o.off = (Math.random() - 0.5) * 1.5; }
      const x = streamCenterX(o.z) + o.off;
      o.mesh.position.set(x, WATER_Y + 0.03 + Math.sin(t * 1.4 + o.ph) * 0.02, o.z);
      o.mesh.rotation.y += o.spin * dt;
    }
  });
}

// ---- lily pads resting on the water ----
{
  const geo = new THREE.CircleGeometry(0.28, 20); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.65, side: THREE.DoubleSide });
  const pads = [];
  for (let i = 0; i < 6; i++) {
    const z = -8 + Math.random() * 14, side = Math.random() > 0.5 ? 1 : -1;
    const x = streamCenterX(z) + side * (0.4 + Math.random() * 0.4);
    const pad = new THREE.Mesh(geo, mat);
    pad.position.set(x, WATER_Y + 0.02, z);
    pad.scale.setScalar(0.65 + Math.random() * 0.8);
    pad.rotation.y = Math.random() * 6.28;
    pad.receiveShadow = true;
    scene.add(pad);
    pads.push({ mesh: pad, ph: Math.random() * 6.28, base: WATER_Y + 0.02 });
  }
  animatedExtras.push((t) => { for (const p of pads) p.mesh.position.y = p.base + Math.sin(t * 0.9 + p.ph) * 0.012; });
}

// ---- butterflies drifting through the glade ----
{
  const wgeo = new THREE.PlaneGeometry(0.13, 0.17); wgeo.translate(0.065, 0, 0);
  const tints = [0xffffff, 0xffe6cf, 0xffd9bc, 0xfff2e2];   // subtle warmth, keeps the monarch pattern
  const butterflies = [];
  for (let i = 0; i < 6; i++) {
    const wmat = new THREE.MeshStandardMaterial({
      map: wingTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7,
      color: tints[i % tints.length], emissive: 0x3a2410, emissiveMap: wingTex, emissiveIntensity: 0.12
    });
    const g = new THREE.Group();
    const wl = new THREE.Mesh(wgeo, wmat);
    const wr = new THREE.Mesh(wgeo, wmat); wr.scale.x = -1;
    g.add(wl, wr);
    scene.add(g);
    g.userData = {
      wl, wr, cx: (Math.random() - 0.5) * 10, cz: -3 + (Math.random() - 0.5) * 9,
      rad: 1.6 + Math.random() * 2.6, h: 0.5 + Math.random() * 1.5,
      sp: 0.18 + Math.random() * 0.22, ph: Math.random() * 6.28, flap: 7 + Math.random() * 4
    };
    butterflies.push(g);
  }
  animatedExtras.push((t) => {
    for (const g of butterflies) {
      const u = g.userData;
      const ang = t * u.sp + u.ph;
      const x = u.cx + Math.cos(ang) * u.rad;
      const z = u.cz + Math.sin(ang * 1.3) * u.rad * 0.7;
      const y = groundHeight(x, z) + u.h + Math.sin(t * 1.5 + u.ph) * 0.22;
      g.position.set(x, y, z);
      g.rotation.y = -ang + Math.PI / 2;
      const f = Math.sin(t * u.flap + u.ph) * 0.9 + 0.25;
      u.wl.rotation.y = f; u.wr.rotation.y = -f;
    }
  });
}

// ---- mist creeping along the stream banks ----
{
  for (let i = 0; i < 10; i++) {
    const z = -12 + i * 2.0 + (Math.random() - 0.5);
    const sm = new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.position.set(streamCenterX(z) + (Math.random() - 0.5) * 1.6, WATER_Y + 0.35, z);
    sp.scale.setScalar(2.4 + Math.random() * 1.8);
    scene.add(sp);
    const u = { ph: Math.random() * 6.28, rate: 0.4 + Math.random() * 0.5, base: WATER_Y + 0.3 + Math.random() * 0.2 };
    animatedExtras.push((t) => {
      sp.material.opacity = 0.13 * (0.5 + 0.5 * Math.sin(t * u.rate + u.ph));
      sp.position.y = u.base + Math.sin(t * 0.2 + u.ph) * 0.15;
    });
  }
}

// ---- whimsical ground mist drifting low across the whole glade ----
// soft warm fog banks hugging the grass — the "fog of the forest"
{
  const N = 42;
  for (let i = 0; i < N; i++) {
    // spread across foreground, mid-ground and back so fog reads everywhere
    const band = i % 5;
    const z = band === 0 ? 1.5 + Math.random() * 5
            : band <= 2 ? -10 + Math.random() * 10       // mid-ground (most visible)
            : -20 + Math.random() * 11;                  // background
    const x = (Math.random() - 0.5) * (z < -6 ? 34 : 24);
    const gy = groundHeight(x, z);
    const sm = new THREE.SpriteMaterial({
      map: mistTex, transparent: true, opacity: 0, depthWrite: false, color: 0xe9cda2
    });
    const sp = new THREE.Sprite(sm);
    const scl = 5 + Math.random() * 6;
    sp.scale.set(scl, scl * 0.5, 1);                 // wide, low banks rather than round puffs
    sp.position.set(x, gy + 0.4 + Math.random() * 0.5, z);
    scene.add(sp);
    const u = {
      ph: Math.random() * 6.28,
      rate: 0.10 + Math.random() * 0.16,
      x0: x, base: gy + 0.45 + Math.random() * 0.5,
      peak: 0.12 + Math.random() * 0.16
    };
    animatedExtras.push((t) => {
      sp.material.opacity = u.peak * (0.6 + 0.4 * Math.sin(t * u.rate + u.ph));
      sp.position.x = u.x0 + Math.sin(t * 0.06 + u.ph) * 2.2;   // slow lateral drift
      sp.position.y = u.base + Math.sin(t * 0.13 + u.ph) * 0.12;
    });
  }
}

// ------------------------------------------------------------
// Moss-covered boulders & mounds — the signature of these woods
// ------------------------------------------------------------
const mossTex = canvasTexture(256, (g, w, h) => {
  g.fillStyle = '#3c5328'; g.fillRect(0, 0, w, h);
  // dense fuzzy speckle for a living moss surface
  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const hue = 78 + Math.random() * 44;          // green through yellow-green
    const sat = 28 + Math.random() * 34;
    const lit = 16 + Math.random() * 30;
    g.fillStyle = `hsla(${hue}, ${sat}%, ${lit}%, ${0.3 + Math.random() * 0.5})`;
    g.beginPath(); g.arc(x, y, 0.7 + Math.random() * 2.3, 0, 6.28); g.fill();
  }
  // darker hollows + brighter sunlit clumps
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(18,30,10,0.45)' : 'rgba(150,180,108,0.4)';
    g.beginPath(); g.arc(x, y, 2 + Math.random() * 6, 0, 6.28); g.fill();
  }
});
const mossMat = new THREE.MeshStandardMaterial({
  map: tiled(mossTex, 1.6, 1.6),
  normalMap: tiled(loadData('assets/textures/rock_nor.jpg'), 1.6, 1.6),
  normalScale: new THREE.Vector2(1.5, 1.5),
  roughness: 1.0, color: 0x9fb47e
});
function mossBoulder(x, z, s, squash, seed) {
  if (nearCard(x, z, 1.25 + s)) return;   // never let a boulder swallow a resting card
  const b = new THREE.Mesh(makeRockGeo(s, seed), mossMat);
  b.position.set(x, groundHeight(x, z) + s * (0.18 - squash * 0.2), z);
  b.scale.y = squash;
  b.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  b.castShadow = true; b.receiveShadow = true;
  scene.add(b);
}
{
  // big mossy mounds + boulder clusters across the glade
  scatter(22, 17, 0.9, (cx, cz, idx) => {
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * 1.6, z = cz + (Math.random() - 0.5) * 1.6;
      if (Math.abs(x - streamCenterX(z)) < 0.9) continue;
      mossBoulder(x, z, 0.32 + Math.random() * 0.95, 0.5 + Math.random() * 0.35, idx * 5.1 + i * 2.7);
    }
  });
  // mossy boulders crowding the stream banks
  for (let i = 0; i < 16; i++) {
    const z = -15 + i * 1.5 + (Math.random() - 0.5);
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = streamCenterX(z) + side * (1.0 + Math.random() * 0.7);
    mossBoulder(x, z, 0.22 + Math.random() * 0.55, 0.65 + Math.random() * 0.3, i * 3.7 + 200);
  }
}

// ------------------------------------------------------------
// Drifting motes & glowing spores
// ------------------------------------------------------------
const moteClouds = [];
{
  for (let c = 0; c < 3; c++) {
    const N = 36;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = 0.3 + Math.random() * 2.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16 - 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.PointsMaterial({
      map: glowSpriteTex, size: 0.07, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    const pts = new THREE.Points(g, m);
    pts.userData.phase = c * 2.1;
    scene.add(pts);
    moteClouds.push(pts);
  }
  // larger teal spores — slow, deliberate drifters
  const N = 22;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 12;
    positions[i * 3 + 1] = 0.5 + Math.random() * 2.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const m = new THREE.PointsMaterial({
    map: glowSpriteTex, size: 0.14, transparent: true, opacity: 0.65,
    color: 0xaaffe4, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  });
  const pts = new THREE.Points(g, m);
  pts.userData.phase = 4.4;
  scene.add(pts);
  moteClouds.push(pts);

  // warm pollen suspended in the light shafts
  const M = 70;
  const pp = new Float32Array(M * 3);
  for (let i = 0; i < M; i++) {
    pp[i * 3] = (Math.random() - 0.5) * 10;
    pp[i * 3 + 1] = 0.2 + Math.random() * 3.0;
    pp[i * 3 + 2] = (Math.random() - 0.5) * 12 - 4;
  }
  const gp = new THREE.BufferGeometry();
  gp.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const mp = new THREE.PointsMaterial({
    map: glowSpriteTex, size: 0.05, transparent: true, opacity: 0.5,
    color: 0xffe7b0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  });
  const ptsP = new THREE.Points(gp, mp);
  ptsP.userData.phase = 5.5;
  scene.add(ptsP);
  moteClouds.push(ptsP);
}

// ------------------------------------------------------------
// The four print cards
// ------------------------------------------------------------
const backTex = loadTex(CARD_BACK_IMG);

const glowMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uIntensity: { value: 0.3 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uIntensity;
    void main(){
      float d = length(vUv - 0.5) * 2.0;
      float a = smoothstep(1.0, 0.15, d) * uIntensity;
      gl_FragColor = vec4(0.78, 0.92, 0.62, a);
    }
  `
});

const rippleMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    void main(){
      float d = length(vUv - 0.5) * 2.0;
      float ring = fract(d * 2.2 - uTime * 0.5);
      float a = smoothstep(0.0, 0.12, ring) * smoothstep(0.35, 0.16, ring);
      a *= smoothstep(1.0, 0.45, d) * 0.06;
      gl_FragColor = vec4(0.85, 0.95, 0.88, a);
    }
  `
});

const cards = [];
const pickMeshes = [];

PRODUCTS.forEach((product, i) => {
  const group = new THREE.Group();

  const frontTex = loadTex(product.img);
  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex, roughness: 0.55, metalness: 0,
    emissive: 0xffffff, emissiveMap: frontTex, emissiveIntensity: 0.32
  });
  // per-card back art (New Orleans has its own gold "Thinking of You" message)
  const thisBackTex = product.back ? loadTex(product.back) : backTex;
  const backMat = new THREE.MeshStandardMaterial({
    map: thisBackTex, roughness: 0.55, metalness: 0,
    emissive: 0xffffff, emissiveMap: thisBackTex, emissiveIntensity: 0.32
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), frontMat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), backMat);
  back.rotation.y = Math.PI;
  back.position.z = -0.004;
  front.position.z = 0.004;
  front.castShadow = true;
  front.userData.cardIndex = i;
  back.userData.cardIndex = i;
  group.add(front, back);
  scene.add(group);
  pickMeshes.push(front, back);

  const state = {
    product, group, index: i,
    mode: 'rest',            // rest | focus
    blend: 0,                // 0 = at rest, 1 = held before the camera
    hover: 0,
    yaw: 0, yawTarget: 0,
    pitch: 0, pitchTarget: 0,
    phase: Math.random() * Math.PI * 2,
    restPos: new THREE.Vector3(),
    restQuat: new THREE.Quaternion(),
    glow: null, ripple: null
  };

  if (!product.floats) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 2.1, CARD_H * 1.7), glowMat());
    glow.rotation.x = -Math.PI / 2;
    const gy = groundHeight(product.rest.x, product.rest.z) + 0.06;
    glow.position.set(product.rest.x, gy, product.rest.z);
    scene.add(glow);
    state.glow = glow;
  } else {
    const ripple = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 2.6, CARD_W * 2.6), rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = WATER_Y + 0.015;
    scene.add(ripple);
    state.ripple = ripple;
  }

  cards.push(state);
});

// ------------------------------------------------------------
// Card pose computation
// ------------------------------------------------------------
const _euler = new THREE.Euler();
const _focusPos = new THREE.Vector3();
const _focusQuat = new THREE.Quaternion();
const _dragQuat = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();

function computeRestPose(card, t) {
  const p = card.product;
  if (p.floats) {
    // kept upstream so it never drifts into the bottom edge of the frame
    const z = -0.5 + Math.sin(t * 0.11 + card.phase) * 0.75;   // range ~ -1.25 .. 0.25
    const x = streamCenterX(z);
    // sits a little higher with a gentler bob so it only dips, never half-submerges
    const y = WATER_Y + 0.13 + Math.sin(t * 1.05 + card.phase) * 0.025;
    card.restPos.set(x, y, z);
    _euler.set(
      -Math.PI / 2 + 0.10 + Math.sin(t * 0.85 + card.phase) * 0.035,   // flatter = shallower dip
      p.rest.yaw + Math.sin(t * 0.18 + card.phase) * 0.35,
      Math.sin(t * 0.7 + card.phase * 2.0) * 0.04,
      'YXZ'
    );
    card.restQuat.setFromEuler(_euler);
    if (card.ripple) { card.ripple.position.x = x; card.ripple.position.z = z; }
  } else {
    const gy = groundHeight(p.rest.x, p.rest.z);
    const lift = card.hover * 0.16;
    // base raised so the tilted lower edge + bob clears the moss, pebbles & flowers
    const y = gy + 0.64 + Math.sin(t * 0.9 + card.phase) * 0.05 + lift;
    card.restPos.set(p.rest.x, y, p.rest.z);
    _euler.set(
      -Math.PI / 2 + 0.52 + Math.sin(t * 0.5 + card.phase) * 0.03 + card.hover * 0.1,
      p.rest.yaw + Math.sin(t * 0.35 + card.phase) * 0.05,
      0,
      'YXZ'
    );
    card.restQuat.setFromEuler(_euler);
  }
}

function computeFocusPose(card, t) {
  camera.getWorldDirection(_dir);
  _right.crossVectors(_dir, camera.up).normalize();
  const bottomSheet = window.innerWidth < 768;   // matches the CSS bottom-sheet breakpoint
  if (bottomSheet) {
    // close & large for a crisp print, centred in the open area above the sheet
    const H = renderer.domElement.clientHeight || window.innerHeight;
    if (panel.classList.contains('peek')) {
      const r = panel.getBoundingClientRect();
      if (r.height > 20) _peekTop = r.top;
    }
    const headerBottom = _cartBtnEl ? _cartBtnEl.getBoundingClientRect().bottom : 64;
    const clearTop = headerBottom + 10;
    const clearBottom = _peekTop - 12;
    const clearMid = (clearTop + clearBottom) * 0.5;
    const clearH = Math.max(90, clearBottom - clearTop);
    const vfov = camera.fov * Math.PI / 180;
    const tanHalf = Math.tan(vfov / 2);
    const cardH = CARD_H * 1.12;
    const targetFrac = (clearH / H) * 0.86;
    let d = cardH / (2 * tanHalf * targetFrac);
    d = THREE.MathUtils.clamp(d, 2.5, 4.8);
    const midFromCenter = 0.5 - clearMid / H;
    const upOffset = midFromCenter * 2 * d * tanHalf;
    _focusPos.copy(camera.position)
      .addScaledVector(_dir, d)
      .addScaledVector(camera.up, upOffset);
  } else {
    _focusPos.copy(camera.position)
      .addScaledVector(_dir, 2.65)
      .addScaledVector(_right, -0.55)        // beside the right-hand side panel
      .addScaledVector(camera.up, -0.05);
  }
  // gentle floating while held — the "flow in place"
  _focusPos.y += Math.sin(t * 1.1 + card.phase) * 0.045;
  _focusPos.addScaledVector(_right, Math.sin(t * 0.7 + card.phase) * 0.03);

  if (bottomSheet) {
    // flat, frontal billboard — parallel to the screen so it reads square-on, not tilted
    _focusQuat.copy(camera.quaternion);
  } else {
    _m4.lookAt(camera.position, _focusPos, camera.up);
    _focusQuat.setFromRotationMatrix(_m4);
  }
  _euler.set(card.pitch + Math.sin(t * 0.9 + card.phase) * 0.025, card.yaw + Math.sin(t * 0.6 + card.phase) * 0.02, 0, 'YXZ');
  _dragQuat.setFromEuler(_euler);
  _focusQuat.multiply(_dragQuat);
}

// ------------------------------------------------------------
// Interaction — hover, focus, drag-to-spin, flip
// ------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const mousePar = new THREE.Vector2();     // parallax
let focusedCard = null;
let hoveredIndex = -1;
let pointerDown = false;
let dragging = false;
let downX = 0, downY = 0, lastX = 0, lastY = 0, moveTotal = 0;
let _focusCooldownUntil = 0;

const panel = document.getElementById('product-panel');
const hintBar = document.getElementById('hint-bar');
const _cartBtnEl = document.getElementById('cart-btn');
let _peekTop = window.innerHeight * 0.58;

function setPanel(product) {
  document.getElementById('product-subtitle').textContent = product.subtitle;
  document.getElementById('product-title').textContent = product.title;
  document.getElementById('product-description').textContent = product.description;
  document.getElementById('product-paper').textContent = product.paper;
  document.getElementById('product-size').textContent = product.size;
  document.getElementById('product-edition').textContent = product.edition;
  document.getElementById('product-price').textContent = `$${product.price.toFixed(2)}`;
  panel.dataset.cardKey = product.key;
}

function setSheet(state) {
  if (state === 'hidden') { panel.classList.remove('open', 'peek', 'expanded'); return; }
  panel.classList.add('open');
  if (window.innerWidth >= 768) { panel.classList.remove('peek', 'expanded'); return; }
  panel.classList.toggle('peek', state === 'peek');
  panel.classList.toggle('expanded', state === 'expanded');
}

function focusCard(card) {
  if (focusedCard && focusedCard !== card) unfocusCard(false);
  focusedCard = card;
  card.mode = 'focus';
  card.yaw = 0; card.yawTarget = 0; card.pitch = 0; card.pitchTarget = 0;
  setPanel(card.product);
  setSheet('peek');
  closeCartDrawer();
  hintBar.classList.add('hidden');
  audio.swell();
  _focusCooldownUntil = Date.now() + 500;
}

function unfocusCard(closePanel = true) {
  if (!focusedCard) return;
  focusedCard.mode = 'rest';
  focusedCard = null;
  if (closePanel) setSheet('hidden');
}

// Mobile sheet gestures — ONE pointer-driven state machine. Tap the handle/header
// to toggle peek/expanded; drag up to expand; drag down to collapse, then close.
// We listen ONLY to pointer events so iOS synthesized events can't flash the sheet.
(function setupSheet() {
  let downY = null, downX = null, startState = null, active = false;
  const onDown = (e) => {
    if (window.innerWidth >= 768) return;
    if (IS_MOBILE && e.pointerType === 'mouse') return;
    if (e.target.closest('button')) return;
    if (e.target.closest('.sheet-body') && panel.classList.contains('expanded')) return;
    active = true; downY = e.clientY; downX = e.clientX;
    startState = panel.classList.contains('expanded') ? 'expanded' : 'peek';
  };
  const onUp = (e) => {
    if (!active) return; active = false;
    if (IS_MOBILE && e.pointerType === 'mouse') return;
    const dy = e.clientY - downY, dx = e.clientX - downX;
    if (Math.abs(dy) < 24 && Math.abs(dx) < 24) {
      if (Date.now() < _focusCooldownUntil) return;
      if (e.target.closest('.sheet-handle') || e.target.closest('.sheet-head')) {
        setSheet(panel.classList.contains('peek') ? 'expanded' : 'peek');
      }
      return;
    }
    if (dy < -28) setSheet('expanded');
    else if (dy > 28) {
      if (startState === 'expanded') setSheet('peek');
      else unfocusCard();
    }
  };
  panel.addEventListener('pointerdown', onDown);
  panel.addEventListener('pointerup', onUp);
})();

function pickCard(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  pointerNdc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  return hits.length ? cards[hits[0].object.userData.cardIndex] : null;
}

const cv = renderer.domElement;

cv.addEventListener('pointerdown', (e) => {
  pointerDown = true;
  dragging = false;
  moveTotal = 0;
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
  try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic events have no live pointer */ }
});

cv.addEventListener('pointermove', (e) => {
  mousePar.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);

  if (pointerDown && focusedCard) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moveTotal += Math.abs(dx) + Math.abs(dy);
    if (moveTotal > 6) dragging = true;
    if (dragging) {
      focusedCard.yaw += dx * 0.0085;
      focusedCard.yawTarget = focusedCard.yaw;
      focusedCard.pitchTarget = THREE.MathUtils.clamp(focusedCard.pitchTarget + dy * 0.004, -0.55, 0.55);
      cv.style.cursor = 'grabbing';
    }
    lastX = e.clientX; lastY = e.clientY;
    return;
  }
  if (pointerDown) {
    moveTotal += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    return;
  }

  // hover highlighting
  const card = pickCard(e.clientX, e.clientY);
  hoveredIndex = card ? card.index : -1;
  cv.style.cursor = card ? (focusedCard === card ? 'grab' : 'pointer') : '';
});

cv.addEventListener('pointerup', (e) => {
  if (IS_MOBILE && e.pointerType === 'mouse') return;
  pointerDown = false;
  const wasDrag = dragging;
  dragging = false;
  if (focusedCard) cv.style.cursor = 'grab';

  if (wasDrag && focusedCard) {
    // a touch of momentum on release
    const vel = (e.clientX - downX) * 0.0009;
    focusedCard.yawTarget = focusedCard.yaw + vel * 8;
    focusedCard.pitchTarget = 0;
    return;
  }
  if (moveTotal > 8) return;   // it was a camera-ish drag, not a tap

  const card = pickCard(e.clientX, e.clientY);
  if (card && card !== focusedCard) focusCard(card);
  else if (!card && focusedCard) {
    if (Date.now() < _focusCooldownUntil) return;
    unfocusCard();
  }
});

document.getElementById('panel-close').addEventListener('click', () => unfocusCard());
document.getElementById('flip-card-btn').addEventListener('click', () => {
  if (!focusedCard) return;
  const nearest = Math.round(focusedCard.yawTarget / Math.PI) * Math.PI;
  focusedCard.yawTarget = nearest + Math.PI;
  audio.swell();
});

// ------------------------------------------------------------
// Cart — persisted locally, checks out through Shopify
// ------------------------------------------------------------
const CART_KEY = 'mossy-glade-cart';
let cart = [];
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { cart = []; }
// drop any persisted items whose product no longer exists / is malformed
cart = (Array.isArray(cart) ? cart : []).filter(it => it && it.qty > 0 && PRODUCTS.some(p => p.key === it.key));

const cartDrawer = document.getElementById('cart-drawer');
const cartItemsEl = document.getElementById('cart-items');
const cartCountEl = document.getElementById('cart-count');
const cartSubtotalEl = document.getElementById('cart-subtotal');
const checkoutBtn = document.getElementById('checkout-btn');
const shopStatus = document.getElementById('shop-status');

function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function cartQty() { return cart.reduce((s, it) => s + it.qty, 0); }

function bumpCart() {
  const b = document.getElementById('cart-btn');
  b.classList.remove('bump');
  void b.offsetWidth;            // restart the animation
  b.classList.add('bump');
}

function addToCart(key) {
  const found = cart.find(it => it.key === key);
  if (found) found.qty += 1;
  else cart.push({ key, qty: 1 });
  saveCart();
  renderCart();
  bumpCart();
  showToast('Added to cart<span class="toast-cta">View cart ↗</span>', true);
  audio.chime();
}

function renderCart() {
  const n = cartQty();
  cartCountEl.textContent = n;
  cartCountEl.classList.toggle('visible', n > 0);

  if (!cart.length) {
    cartItemsEl.innerHTML = '<div class="cart-empty">Nothing gathered yet.<br>Lift a card from the moss to begin.</div>';
  } else {
    cartItemsEl.innerHTML = cart.map(it => {
      const p = PRODUCTS.find(pr => pr.key === it.key);
      return `
        <div class="cart-item">
          <img src="${p.img}" alt="${p.subtitle}">
          <div class="ci-info">
            <div class="ci-title">${p.title}</div>
            <div class="ci-sub">${p.subtitle}</div>
            <div class="ci-qty">
              <button data-act="dec" data-key="${it.key}" aria-label="Decrease">−</button>
              <span>${it.qty}</span>
              <button data-act="inc" data-key="${it.key}" aria-label="Increase">+</button>
            </div>
          </div>
          <div class="ci-price">$${(p.price * it.qty).toFixed(2)}</div>
        </div>`;
    }).join('');
  }

  const subtotal = cart.reduce((s, it) => {
    const p = PRODUCTS.find(pr => pr.key === it.key);
    return s + p.price * it.qty;
  }, 0);
  cartSubtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  checkoutBtn.disabled = cart.length === 0;

  if (isConfigured()) {
    shopStatus.textContent = `Checkout via ${SHOPIFY.domain}`;
    shopStatus.classList.remove('demo');
  } else {
    shopStatus.textContent = 'Demo mode — add your Shopify domain & variant IDs in js/shopify-config.js to take real orders.';
    shopStatus.classList.add('demo');
  }
}

cartItemsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const it = cart.find(x => x.key === btn.dataset.key);
  if (!it) return;
  it.qty += btn.dataset.act === 'inc' ? 1 : -1;
  if (it.qty <= 0) cart = cart.filter(x => x !== it);
  saveCart();
  renderCart();
});

checkoutBtn.addEventListener('click', async () => {
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Opening…';
  try {
    const url = await buildCheckoutUrl(cart.map(it => ({ variantKey: it.key, qty: it.qty })));
    if (url) { window.location.href = url; return; }
    showToast('Demo mode — connect Shopify in js/shopify-config.js');
  } catch (err) {
    showToast('Could not open checkout — please try again.');
  } finally {
    checkoutBtn.disabled = cart.length === 0;
    checkoutBtn.textContent = 'Checkout';
  }
});

function openCartDrawer() { renderCart(); cartDrawer.classList.add('open'); if (focusedCard) unfocusCard(); }
function closeCartDrawer() { cartDrawer.classList.remove('open'); }

document.getElementById('cart-btn').addEventListener('click', () => {
  cartDrawer.classList.contains('open') ? closeCartDrawer() : openCartDrawer();
});
document.getElementById('cart-close').addEventListener('click', closeCartDrawer);
(function () {
  const addBtn = document.getElementById('add-to-cart');
  let lastAdd = 0;
  const doAdd = () => {
    const now = Date.now();
    if (now - lastAdd < 450) return;
    lastAdd = now;
    const key = focusedCard ? focusedCard.product.key : panel.dataset.cardKey;
    if (key) addToCart(key);
  };
  addBtn.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); doAdd(); });
  addBtn.addEventListener('click', doAdd);
})();

let toastTimer;
const toastEl = document.getElementById('toast');
toastEl.addEventListener('click', () => { if (toastEl.classList.contains('clickable')) openCartDrawer(); });
function showToast(msg, clickable = false) {
  toastEl.innerHTML = msg;
  toastEl.classList.toggle('clickable', clickable);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), clickable ? 3600 : 2400);
}

renderCart();

// ------------------------------------------------------------
// Audio — disabled. Silent no-op stub so existing call sites
// (swell / chime / etc.) stay harmless. Re-enable later if wanted.
// ------------------------------------------------------------
const audio = { start() {}, toggle() { return false; }, swell() {}, chime() {} };

// ------------------------------------------------------------
// Intro
// ------------------------------------------------------------
document.getElementById('enter-btn').addEventListener('click', () => {
  document.getElementById('intro').classList.add('hidden');
  setTimeout(() => hintBar.classList.add('hidden'), 12000);
});

// ------------------------------------------------------------
// Animation loop
// ------------------------------------------------------------
const clock = new THREE.Clock();
const _lerpPos = new THREE.Vector3();
const _lerpQuat = new THREE.Quaternion();

function easeInOut(t) { return t * t * (3 - 2 * t); }

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  grassMat.uniforms.uTime.value = t;
  foamMat.uniforms.uTime.value = t;
  rippleMat.uniforms.uTime.value = t;
  water.material.uniforms.time.value = t * 0.55;
  beamMats.forEach(m => { m.uniforms.uTime.value = t; });
  swayMats.forEach(m => { m.uniforms.uTime.value = t; });
  if (skyMat) skyMat.uniforms.uTime.value = t;

  mistSprites.forEach(ms => {
    if (ms.mat) { ms.mat.uniforms.uTime.value = t; return; }
    const sp = ms.mesh, u = sp.userData;
    const cyc = (t * u.speed + u.phase) % 1;
    sp.position.y = u.baseY + cyc * u.rise;
    sp.material.opacity = 0.24 * Math.sin(cyc * Math.PI);
  });

  bioPulse.forEach(b => {
    b.mesh.material.emissiveIntensity = 1.2 + Math.sin(t * 1.3 + b.phase) * 0.7;
  });

  for (let i = 0; i < animatedExtras.length; i++) animatedExtras[i](t, dt);

  // camera: soft breathing + mouse parallax
  camera.position.x = CAM_BASE.x + Math.sin(t * 0.13) * 0.18 + mousePar.x * 0.45;
  camera.position.y = CAM_BASE.y + Math.sin(t * 0.17) * 0.08 - mousePar.y * 0.22;
  camera.position.z = CAM_BASE.z;
  camera.lookAt(CAM_LOOK);

  // motes drift
  moteClouds.forEach((pts, ci) => {
    pts.position.y = Math.sin(t * 0.21 + pts.userData.phase) * 0.25;
    pts.position.x = Math.sin(t * 0.1 + pts.userData.phase * 1.7) * 0.4;
    pts.material.opacity = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8 + ci * 2.0));
  });

  // cards
  cards.forEach((card) => {
    // hover ease
    const hoverGoal = (card.index === hoveredIndex && card !== focusedCard) ? 1 : 0;
    card.hover += (hoverGoal - card.hover) * Math.min(1, dt * 7);
    if (card.glow) card.glow.material.uniforms.uIntensity.value = 0.13 + card.hover * 0.4;

    // focus blend
    const blendGoal = card.mode === 'focus' ? 1 : 0;
    card.blend += (blendGoal - card.blend) * Math.min(1, dt * 4.2);

    // spin easing toward target (momentum / flip button)
    if (!dragging || card !== focusedCard) {
      card.yaw += (card.yawTarget - card.yaw) * Math.min(1, dt * 5.5);
    }
    card.pitch += (card.pitchTarget - card.pitch) * Math.min(1, dt * 5.5);
    if (!dragging && card === focusedCard) {
      card.pitchTarget *= 1 - Math.min(1, dt * 1.8);   // drift back upright
    }

    computeRestPose(card, t);
    const k = easeInOut(card.blend);

    if (k < 0.001) {
      card.group.position.copy(card.restPos);
      card.group.quaternion.copy(card.restQuat);
    } else {
      computeFocusPose(card, t);
      _lerpPos.lerpVectors(card.restPos, _focusPos, k);
      _lerpQuat.slerpQuaternions(card.restQuat, _focusQuat, k);
      card.group.position.copy(_lerpPos);
      card.group.quaternion.copy(_lerpQuat);
    }
    const s = 1 + k * 0.12;
    card.group.scale.setScalar(s);
  });

  composer.render();
}
animate();

window.addEventListener('resize', resizeRenderer);
window.addEventListener('orientationchange', () => setTimeout(resizeRenderer, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeRenderer);

// Console/integration hooks (handy for testing and future Shopify wiring)
window.__glade = {
  focus: (key) => { const c = cards.find(x => x.product.key === key); if (c) focusCard(c); },
  unfocus: () => unfocusCard(),
  flip: () => document.getElementById('flip-card-btn').click(),
  addToCart,
  cart: () => cart.slice(),
  products: PRODUCTS
};
