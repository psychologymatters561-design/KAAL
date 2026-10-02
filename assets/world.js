/* ══════════════════════════════════════════════════════════════════
   KAAL · THE WORLD BEHIND THE PAGE

   One fixed WebGL canvas behind every act, so the page reads as one place
   travelled through rather than a stack of sections. Scrolling is time:
   the camera moves forward through it, each act is a dial ring you pass
   through, and the rings step once a second, like the quartz movement
   inside the watch.

     the room    a full-screen shader: the act's own colour, a slow light
                 pool with smoke drifting through it, a vignette
     the dust    a few hundred soft motes in depth, so moving forward
                 has parallax without anything on the page moving
     the rings   one minute track per act, sixty ticks, at the act's own
                 place on the journey; the ring for the twenty is the
                 brightest, because that is where the journey goes

   This file is a module, loaded by index.html only after the page has
   loaded and only where it can run well: module scripts, WebGL2, motion
   allowed, no Save-Data, KAAL.features.world3d on. Everything here is an
   addition. If any of it fails, or the device cannot hold 40fps with it,
   it removes itself and the colour wash in index.html (driveWorld) is the
   world, exactly as before. ?world=1 skips the speed check, for review.

   GSAP drives the choreography: one scrubbed ScrollTrigger carries the
   camera along the whole page with weight, and one trigger per act eases
   the room into that act's colour and light as it takes the screen.
   ══════════════════════════════════════════════════════════════════ */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, PlaneGeometry, RingGeometry,
  ShaderMaterial, BufferGeometry, Float32BufferAttribute, Points, Color,
  AdditiveBlending, NormalBlending, ColorManagement, LinearSRGBColorSpace, Vector2
} from "./vendor/three.module.min.js";

/* Colours here are written as the screen shows them, and handed to the
   shaders as they are. Off before the first Color is made. */
ColorManagement.enabled = false;

const gsap = window.gsap, ST = window.ScrollTrigger;
const root = document.documentElement;
const qs = new URLSearchParams(location.search);
const FORCE = qs.get("world") === "1";
const PHONE = matchMedia("(max-width: 599px), (pointer: coarse)").matches;
const LOW = root.classList.contains("lowfx");

/* Each act's room. `base` is the same colour the CSS world paints for that
   act, so text contrast never changes; the light and the smoke are added
   on top of it and stay dim enough that the words are always the
   brightest thing on the screen. */
const ROOMS = {
  void:     { base:"#080908", light:"#EDE8DF", amt:.05, dust:.24, ring:.10 },
  stone:    { base:"#12100E", light:"#D8D0C2", amt:.07, dust:.26, ring:.11 },
  emerald:  { base:"#08120C", light:"#4E8A65", amt:.17, dust:.24, ring:.12 },
  midnight: { base:"#050505", light:"#B8BABE", amt:.07, dust:.22, ring:.13 },
  ember:    { base:"#140C04", light:"#D19B3F", amt:.15, dust:.16, ring:.12 }
};
const L = 100;                         /* the journey's length, in world units */

let renderer, canvas, scene, bgScene, camera, bg, dust, heroST = null, rings = [], st = [], alive = true, paused = false;
const U = {
  uTime:   { value: 0 },
  uRes:    { value: new Vector2(1, 1) },
  uBase:   { value: new Color(ROOMS.void.base) },
  uLight:  { value: new Color(ROOMS.void.light) },
  uAmt:    { value: ROOMS.void.amt },
  uLP:     { value: new Vector2(.45, .22) },
  uScroll: { value: 0 },
  uDust:   { value: ROOMS.void.dust },
  uRing:   { value: new Color("#C6A15B") },
  uRingAmt:{ value: ROOMS.void.ring },
  uSec:    { value: 0 },
  uPR:     { value: 1 }
};
const S = { prog: 0 };

function bail(why){
  if(!alive) return;
  alive = false;
  root.classList.remove("world-gl");
  st.forEach(t => t.kill());
  if(canvas){
    canvas.style.transition = "opacity .6s";
    canvas.style.opacity = "0";
    setTimeout(() => {
      try{ renderer && renderer.dispose(); renderer && renderer.forceContextLoss(); }catch(e){}
      canvas.remove();
    }, 700);
  }
  window.kaalWorld = { on:false, why };
}

/* ── THE ROOM. Value noise, four octaves, one warp: smoke that never
      repeats and never resolves into a shape. A one-level dither keeps
      the dark gradients from banding on eight-bit screens. */
const NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }`;
const BG_V = `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BG_F = `
  uniform vec3 uBase, uLight; uniform vec2 uRes, uLP; uniform float uTime, uAmt, uScroll;
  ${NOISE}
  void main(){
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    float t = uTime;
    vec2 q = p * 1.5 + vec2(t * 0.010, -uScroll * 0.9 + t * 0.014);
    float s = fbm(q + 0.85 * fbm(q * 0.7 - t * 0.016));
    vec2 d = p - uLP;
    float pool = exp(-dot(d, d) * 2.0);
    vec2 d2 = p + uLP * vec2(1.1, 1.6);
    float pool2 = exp(-dot(d2, d2) * 3.2) * 0.45;
    vec3 col = uBase;
    col += uLight * uAmt * (pool + pool2) * (0.30 + 0.95 * s);
    col += uLight * uAmt * 0.22 * smoothstep(0.52, 0.86, s);
    float v = smoothstep(1.35, 0.15, length(p * vec2(0.85, 1.05)));
    col *= mix(0.70, 1.0, v);
    col += (hash(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * (1.6 / 255.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

/* ── THE DUST. Soft discs, larger the nearer they are, fading in from the
      dark and out again before they could fill the screen. They rise very
      slowly and wrap, so the air is never empty and never the same. */
const DUST_V = `
  uniform float uTime, uPR;
  attribute float aSize, aSeed, aTint;
  varying float vA, vTint;
  void main(){
    vec3 p = position;
    p.x += sin(uTime * 0.07 + aSeed * 40.0) * 0.35;
    p.y = mod(position.y + 4.5 + uTime * (0.035 + aSeed * 0.05), 9.0) - 4.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    gl_PointSize = clamp(aSize * uPR * 46.0 / max(d, 0.1), 0.0, 56.0 * uPR);
    vA = smoothstep(0.8, 2.6, d) * (1.0 - smoothstep(16.0, 30.0, d))
       * (0.6 + 0.4 * sin(uTime * 0.55 + aSeed * 30.0));
    vTint = aTint;
    gl_Position = projectionMatrix * mv;
  }`;
const DUST_F = `
  uniform vec3 uLight; uniform float uDust;
  varying float vA, vTint;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    float a = exp(-r2 * 3.4) * (1.0 - smoothstep(0.8, 1.0, r2));
    vec3 col = mix(vec3(1.0, 0.92, 0.80), uLight, vTint * 0.55);
    gl_FragColor = vec4(col, a * vA * uDust);
  }`;

/* ── THE RINGS. A minute track drawn in the shader, so it is sharp at any
      size: sixty ticks, every fifth longer, a hairline inside them, and
      one brighter tick that steps once a second. Antialiased with the
      screen-space derivative of the angle, so the ticks stay one clean
      line whether the ring is far ahead or passing round the screen. */
const RING_V = `
  varying vec2 vPos; varying float vDA;
  void main(){
    vPos = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vDA = smoothstep(2.6, 6.5, d) * (1.0 - smoothstep(11.0, 19.0, d));
    gl_Position = projectionMatrix * mv;
  }`;
const RING_F = `
  uniform vec3 uRing; uniform float uRingAmt, uR, uGain, uSec;
  varying vec2 vPos; varying float vDA;
  void main(){
    float r = length(vPos) / uR;
    float u = atan(vPos.y, vPos.x) / 6.28318530718 * 60.0;
    float fu = max(fwidth(u), 1e-4), fr = max(fwidth(r), 1e-4);
    float dt = abs(fract(u + 0.5) - 0.5);
    float tick = 1.0 - smoothstep(0.07 - fu, 0.07 + fu, dt);
    float major = step(abs(fract(u / 5.0 + 0.5) - 0.5) * 5.0, 0.5);
    float hand = step(abs(mod(u - uSec + 30.0, 60.0) - 30.0), 0.5);
    float inner = mix(mix(0.952, 0.905, major), 0.88, hand);
    float len = smoothstep(inner - fr, inner + fr, r) * (1.0 - smoothstep(0.998 - fr, 0.998 + fr, r));
    float line = 1.0 - smoothstep(0.0, fr * 1.4, abs(r - 0.862));
    float a = tick * len * mix(mix(0.5, 1.0, major), 2.4, hand) + line * 0.45;
    gl_FragColor = vec4(uRing, a * uRingAmt * uGain * vDA);
  }`;

function build(){
  canvas = document.createElement("canvas");
  canvas.className = "world-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const after = document.getElementById("worldNext") || document.getElementById("world");
  if(after && after.parentNode) after.parentNode.insertBefore(canvas, after.nextSibling);
  else document.body.insertBefore(canvas, document.body.firstChild);

  renderer = new WebGLRenderer({ canvas, antialias:false, alpha:false, depth:false, stencil:false,
                                 powerPreference: PHONE ? "low-power" : "default" });
  const gl = renderer.getContext();
  if(!gl || typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) throw new Error("webgl2");

  /* A software rasteriser draws this at a few frames a second and takes
     the main thread with it. The colour wash is a better world than that. */
  if(!FORCE){
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    if(/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) throw new Error("software gl: " + gpu);
  }
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.autoClear = false;
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); bail("context lost"); });

  scene = new Scene();
  camera = new PerspectiveCamera(55, 1, 0.1, 120);

  bg = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    vertexShader: BG_V, fragmentShader: BG_F, uniforms: U, depthTest:false, depthWrite:false
  }));
  bg.frustumCulled = false;
  bgScene = new Scene();
  bgScene.add(bg);

  const N = PHONE ? (LOW ? 180 : 240) : 460;
  const pos = [], size = [], seed = [], tint = [];
  for(let i = 0; i < N; i++){
    pos.push((Math.random() * 2 - 1) * 7, (Math.random() * 2 - 1) * 4.5, 6 - Math.random() * (L + 18));
    size.push(0.5 + Math.pow(Math.random(), 3) * 2.6);
    seed.push(Math.random());
    tint.push(Math.random());
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aSize", new Float32BufferAttribute(size, 1));
  g.setAttribute("aSeed", new Float32BufferAttribute(seed, 1));
  g.setAttribute("aTint", new Float32BufferAttribute(tint, 1));
  dust = new Points(g, new ShaderMaterial({
    vertexShader: DUST_V, fragmentShader: DUST_F, uniforms: U,
    transparent:true, depthTest:false, depthWrite:false, blending: AdditiveBlending
  }));
  dust.frustumCulled = false;
  scene.add(dust);
}

/* One ring per act, placed where that act sits on the journey, so the
   camera passes through a ring as each act takes the screen. Rebuilt on
   every refresh, because where the acts sit depends on the layout. */
function placeRings(acts){
  rings.forEach(r => { scene.remove(r); r.geometry.dispose(); r.material.dispose(); });
  rings = [];
  const max = Math.max(1, ST.maxScroll(window));
  const vh = window.innerHeight;
  acts.forEach((el, i) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    const at = Math.min(1, Math.max(0, (top - vh * 0.15) / max));
    const R = 3.7 + (i % 3) * 0.45;
    const m = new Mesh(new RingGeometry(R * 0.84, R, 240, 1), new ShaderMaterial({
      vertexShader: RING_V, fragmentShader: RING_F,
      uniforms: { uRing: U.uRing, uRingAmt: U.uRingAmt, uSec: U.uSec,
                  uR: { value: R }, uGain: { value: el.id === "twenty" ? 1.9 : 1 } },
      transparent:true, depthTest:false, depthWrite:false, blending: NormalBlending
    }));
    m.position.set(i % 2 ? 0.5 : -0.5, i % 2 ? -0.2 : 0.25, -at * L - 4.2);
    m.userData = { spin: (i % 2 ? -1 : 1) * (0.5 + (i % 3) * 0.15), base: i * 0.7 };
    m.frustumCulled = false;
    scene.add(m);
    rings.push(m);
  });
}

let W = 0, H = 0;
function size(force){
  /* The canvas is a large-viewport box (100lvh), so the phone's URL bar
     moving does not resize it: a drawing buffer reallocated mid-scroll is
     exactly the stall this page exists to avoid. Only a real change of
     shape resizes it. */
  const w = window.innerWidth, h = Math.max(window.innerHeight, canvas.clientHeight || 0);
  if(!force && w === W && Math.abs(h - H) < 120) return;
  W = w; H = h;
  const pr = PHONE ? Math.min(window.devicePixelRatio || 1, 1) : Math.min(window.devicePixelRatio || 1, LOW ? 1 : 1.25);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  U.uRes.value.set(W * pr, H * pr);
  U.uPR.value = pr;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

function room(name, i){
  const r = ROOMS[name] || ROOMS.void, c1 = new Color(r.base), c2 = new Color(r.light);
  const ease = "sine.inOut", d = 1.6;
  gsap.to(U.uBase.value,  { r:c1.r, g:c1.g, b:c1.b, duration:d, ease, overwrite:true });
  gsap.to(U.uLight.value, { r:c2.r, g:c2.g, b:c2.b, duration:d, ease, overwrite:true });
  gsap.to(U.uAmt,     { value:r.amt,  duration:d, ease, overwrite:true });
  gsap.to(U.uDust,    { value:r.dust * (PHONE ? 0.85 : 1), duration:d, ease, overwrite:true });
  gsap.to(U.uRingAmt, { value:r.ring, duration:d, ease, overwrite:true });
  /* The light falls on the side the act's picture is not, alternating as
     the acts do, so it lights the room rather than competing with a
     photograph. */
  gsap.to(U.uLP.value, { x: i % 2 ? -0.5 : 0.48, y: i % 2 ? -0.08 : 0.24, duration:2.2, ease, overwrite:true });
}

function choreograph(){
  const hero = document.getElementById("hero");
  const acts = Array.prototype.slice.call(document.querySelectorAll(".act[data-world]"));

  /* The camera's journey: the whole page, with weight. scrub 1.4 is the
     second and a half the world takes to catch up with a flick, which is
     what makes it feel like a place moving past rather than a picture
     glued to the scrollbar. */
  st.push(ST.create({ start:0, end:"max", scrub:1.4,
    animation: gsap.to(S, { prog:1, ease:"none" }) }));

  /* The film owns the screen. The world comes up only as it hands over —
     across the last seventh of the hero, under the dimmed film and the rising
     band, and never draws a pixel before. */
  if(hero){
    heroST = ST.create({ trigger: hero, start: "top top",
      end: () => "+=" + Math.max(1, hero.offsetHeight - window.innerHeight) });
    st.push(heroST);
  }

  acts.forEach((el, i) => {
    st.push(ST.create({ trigger: el, start: "top 55%", end: "bottom 55%",
      onToggle: self => { if(self.isActive) room(el.dataset.world, i); } }));
  });
  placeRings(acts);
  ST.addEventListener("refresh", () => placeRings(acts));
}

/* ── THE LOOP. GSAP's ticker, so the camera, the tweens and the paint are
      one frame. Sixty a second while anything moves, thirty while the
      world only drifts, none while the film owns the screen or checkout
      is open. */
let frames = 0, lastProg = -1, odd = false, watch = [], t0 = performance.now();
function tick(time, dt){
  if(!alive || paused) return;
  const fade = heroST ? Math.min(1, Math.max(0, (heroST.progress - 0.86) / 0.14)) : 1;
  if(canvas._f !== fade){ canvas._f = fade; canvas.style.opacity = fade.toFixed(3); }
  if(fade <= 0.001) return;

  const moving = Math.abs(S.prog - lastProg) > 1e-5 || gsap.isTweening(U.uAmt);
  lastProg = S.prog;
  odd = !odd;
  if(!moving && odd) return;

  const secs = (performance.now() - t0) / 1000;
  U.uTime.value = secs;
  /* The quartz step: one tick a second, settled in 90ms. */
  const whole = Math.floor(secs), f = Math.min(1, (secs - whole) / 0.09);
  U.uSec.value = (whole + 1 - Math.pow(1 - f, 3)) % 60;
  U.uScroll.value = S.prog * 6.0;

  camera.position.set(Math.sin(S.prog * Math.PI * 3) * 0.35 + px * 0.25, Math.cos(S.prog * Math.PI * 2) * 0.2 + py * 0.18, 4 - S.prog * L);
  camera.lookAt(px * 0.6, py * 0.4, camera.position.z - 10);
  for(let i = 0; i < rings.length; i++){
    const r = rings[i];
    r.rotation.z = r.userData.base + S.prog * Math.PI * r.userData.spin;
  }

  renderer.clear();
  renderer.render(bgScene, camera);
  renderer.render(scene, camera);

  /* The speed check. After the first ninety painted frames with the world
     fully up, if the median frame took longer than 28ms the device is
     paying for this in scroll smoothness, and the world steps aside. */
  if(!FORCE && fade >= 0.99 && watch.length < 90){
    watch.push(dt);
    if(watch.length === 90){
      const m = watch.slice().sort((a, b) => a - b)[45];
      if(m > 28) bail("slow: median " + m.toFixed(1) + "ms");
    }
  }
  frames++;
}

/* A pointer on a desktop leans the camera a little toward it. */
let px = 0, py = 0;
if(!PHONE){
  let tx = 0, ty = 0;
  addEventListener("pointermove", e => {
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = -((e.clientY / window.innerHeight) * 2 - 1);
  }, { passive:true });
  gsap.ticker.add(() => { px += (tx - px) * 0.04; py += (ty - py) * 0.04; });
}

try{
  if(!gsap || !ST) throw new Error("gsap missing");
  gsap.registerPlugin(ST);
  build();
  size(true);
  choreograph();
  addEventListener("resize", () => { if(alive) size(false); }, { passive:true });
  gsap.ticker.add(tick);
  root.classList.add("world-gl");
  window.kaalWorld = {
    on: true,
    refresh(){ if(alive) ST.refresh(); },
    pause(p){ paused = !!p; },
    stop(){ bail("stopped"); },
    get frames(){ return frames; }
  };
}catch(e){
  bail(String(e && e.message || e));
}
