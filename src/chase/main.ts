import * as THREE from 'three';
import './chase.css';

type Mode = 'pov' | 'front' | 'chase' | 'side';
const MODES: Mode[] = ['pov', 'front', 'chase', 'side'];
const MODE_NAMES: Record<Mode, string> = {
  pov: 'Камера: из машины',
  front: 'Камера: спереди',
  chase: 'Камера: из-за спины убийцы',
  side: 'Камера: сбоку',
};

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const canvas = $('scene') as HTMLCanvasElement;
const mirrorFrame = $('mirror');
const speedEl = $('speed');
const distEl = $('dist');
const modeEl = $('mode');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const NIGHT = new THREE.Color(0x05070d);
const FLASH = new THREE.Color(0x9aa6cc);
const bg = NIGHT.clone();
scene.background = bg;
const fog = new THREE.FogExp2(0x05070d, 0.026);
scene.fog = fog;

const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
const rearCam = new THREE.PerspectiveCamera(55, 3, 0.1, 300);

const hemi = new THREE.HemisphereLight(0x3a4a7a, 0x0a0a0a, 0.4);
scene.add(hemi);
const moonLight = new THREE.DirectionalLight(0x8899cc, 0.35);
moonLight.position.set(-20, 40, -30);
scene.add(moonLight);

const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }));
moon.position.set(-70, 55, -220);
scene.add(moon);

const starPositions: number[] = [];
for (let i = 0; i < 700; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI * 0.45;
  const r = 320;
  starPositions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false })));

// Дорога и земля
const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 600), new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.85 }));
road.rotation.x = -Math.PI / 2;
road.position.z = -200;
scene.add(road);
const grassMat = new THREE.MeshStandardMaterial({ color: 0x0a160c, roughness: 1 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 });
for (const side of [-1, 1]) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 600), grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(side * 105, -0.01, -200);
  scene.add(grass);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 600), edgeMat);
  edge.position.set(side * 4.6, 0.01, -200);
  scene.add(edge);
}

// Движущиеся объекты: разметка, фонари, деревья
const SPAN = 360;
const BACK = 60;
const movers: THREE.Object3D[] = [];

const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2d44a, emissive: 0x332800, roughness: 0.5 });
const dashGeo = new THREE.BoxGeometry(0.18, 0.02, 2.2);
for (let z = BACK; z > BACK - SPAN; z -= 8) {
  const dash = new THREE.Mesh(dashGeo, dashMat);
  dash.position.set(0, 0.012, z);
  scene.add(dash);
  movers.push(dash);
}

interface Lamp {
  light: THREE.PointLight;
  bulb: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  flicker: boolean;
  seed: number;
}
const lamps: Lamp[] = [];
const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.5 });
const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 8);
const armGeo = new THREE.BoxGeometry(1.6, 0.08, 0.08);
const bulbGeo = new THREE.SphereGeometry(0.18, 12, 8);
const beamGeo = new THREE.ConeGeometry(2.2, 5.8, 20, 1, true);
const LAMP_COUNT = 12;
for (let i = 0; i < LAMP_COUNT; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const group = new THREE.Group();
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 3;
  const arm = new THREE.Mesh(armGeo, postMat);
  arm.position.set(-side * 0.75, 6, 0);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc070, emissiveIntensity: 2 });
  const bulb = new THREE.Mesh(bulbGeo, bulbMat);
  bulb.position.set(-side * 1.5, 5.85, 0);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(-side * 1.5, 2.95, 0);
  const light = new THREE.PointLight(0xffb060, 30, 16, 2);
  light.position.set(-side * 1.5, 5.6, 0);
  group.add(post, arm, bulb, beam, light);
  group.position.set(side * 5.6, 0, BACK - i * (SPAN / LAMP_COUNT));
  scene.add(group);
  movers.push(group);
  lamps.push({ light, bulb: bulbMat, beam, flicker: i % 3 === 1, seed: i * 1.7 });
}

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x0f2a14, roughness: 1 });
const trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6);
const leafGeo = new THREE.ConeGeometry(1.3, 3.2, 7);
for (let i = 0; i < 80; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.8;
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  leaves.position.y = 2.8;
  const top = new THREE.Mesh(leafGeo, leafMat);
  top.position.y = 3.9;
  top.scale.setScalar(0.72);
  tree.add(trunk, leaves, top);
  tree.scale.setScalar(0.8 + Math.random() * 1.1);
  tree.position.set(side * (8.5 + Math.random() * 32), 0, BACK - Math.random() * SPAN);
  tree.rotation.y = Math.random() * Math.PI;
  scene.add(tree);
  movers.push(tree);
}

// Машина игрока
const car = new THREE.Group();
scene.add(car);
const paint = new THREE.MeshStandardMaterial({ color: 0x8a0e12, metalness: 0.7, roughness: 0.35 });
const glass = new THREE.MeshStandardMaterial({ color: 0x0c1118, metalness: 0.9, roughness: 0.1 });
const carBody = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.3), paint);
carBody.position.y = 0.65;
const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.55, 2.1), glass);
cabin.position.set(0, 1.22, 0.35);
const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.8 }));
dashboard.position.set(0, 1.0, -0.55);
const steering = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
steering.position.set(-0.4, 1.12, -0.3);
steering.rotation.x = -0.5;
car.add(carBody, cabin, dashboard, steering);

const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 18);
wheelGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
const wheels: THREE.Mesh[] = [];
for (const [x, z] of [[-1.02, -1.4], [1.02, -1.4], [-1.02, 1.45], [1.02, 1.45]]) {
  const wheel = new THREE.Mesh(wheelGeo, tireMat);
  wheel.position.set(x, 0.4, z);
  car.add(wheel);
  wheels.push(wheel);
}

const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 3 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 2.5 });
for (const x of [-0.7, 0.7]) {
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), headMat);
  head.position.set(x, 0.72, -2.16);
  const spot = new THREE.SpotLight(0xfff1d0, 120, 70, 0.42, 0.55, 1.5);
  spot.position.set(x, 0.75, -2.2);
  spot.target.position.set(x * 1.5, 0, -25);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.05), tailMat);
  tail.position.set(x, 0.75, 2.16);
  car.add(head, spot, spot.target, tail);
}
const tailLight = new THREE.PointLight(0xff2020, 10, 14, 2);
tailLight.position.set(0, 0.9, 2.7);
car.add(tailLight);

// Убийца
const killer = new THREE.Group();
scene.add(killer);
const coat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
const pants = new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.9 });
const maskMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d4, roughness: 0.6 });
const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.2 });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function limb(width: number, length: number, material: THREE.Material, x: number, y: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(part(new THREE.BoxGeometry(width, length, width), material, 0, -length / 2, 0));
  return pivot;
}

const torso = part(new THREE.BoxGeometry(0.62, 0.85, 0.36), coat, 0, 1.48, 0);
const hood = part(new THREE.SphereGeometry(0.25, 16, 12), coat, 0, 2.08, 0.04);
const mask = part(new THREE.SphereGeometry(0.21, 16, 12), maskMat, 0, 2.06, -0.1);
mask.scale.set(1, 1.15, 0.7);
killer.add(torso, hood, mask);
for (const x of [-0.075, 0.075]) {
  killer.add(part(new THREE.SphereGeometry(0.045, 10, 8), holeMat, x, 2.1, -0.235));
  killer.add(part(new THREE.SphereGeometry(0.022, 8, 6), eyeMat, x, 2.1, -0.262));
}
for (const x of [-0.06, -0.02, 0.02, 0.06]) killer.add(part(new THREE.BoxGeometry(0.012, 0.06, 0.02), holeMat, x, 1.96, -0.245));
const legL = limb(0.22, 0.95, pants, -0.16, 1.05);
const legR = limb(0.22, 0.95, pants, 0.16, 1.05);
const armL = limb(0.16, 0.78, coat, -0.42, 1.85);
const armR = limb(0.16, 0.78, coat, 0.42, 1.85);
armR.add(part(new THREE.BoxGeometry(0.05, 0.14, 0.05), holeMat, 0, -0.84, 0));
armR.add(part(new THREE.BoxGeometry(0.035, 0.5, 0.1), steel, 0, -1.15, 0));
killer.add(legL, legR, armL, armR);

// Звук (включается по нажатию «Начать»)
let audio: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let nextBeat = 0;
const engine: OscillatorNode[] = [];

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function startAudio(): void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || audio) return;
  const ctx = new Ctx();
  audio = ctx;
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 380;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0.06;
  filter.connect(engineGain);
  engineGain.connect(master);
  const types: OscillatorType[] = ['sawtooth', 'square'];
  types.forEach((type, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 48 * (i + 1);
    osc.connect(filter);
    osc.start();
    engine.push(osc);
  });
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer(ctx, 2);
  wind.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 600;
  band.Q.value = 0.6;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.05;
  wind.connect(band);
  band.connect(windGain);
  windGain.connect(master);
  wind.start();
  nextBeat = ctx.currentTime + 0.5;
}

function thump(time: number, volume: number): void {
  if (!audio || !master) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(75, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
  osc.connect(gain);
  gain.connect(master);
  osc.start(time);
  osc.stop(time + 0.25);
}

function thunder(): void {
  if (!audio || !master) return;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, 3);
  const low = audio.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 280;
  const gain = audio.createGain();
  const peak = audio.currentTime + 0.35;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(1.2, peak);
  gain.gain.exponentialRampToValueAtTime(0.0001, peak + 2.6);
  src.connect(low);
  low.connect(gain);
  gain.connect(master);
  src.start();
  src.stop(peak + 3);
}

// Камеры и управление
let modeIndex = 0;
let autoCycle = true;
let modeTimer = 0;

function setMode(index: number): void {
  modeIndex = index;
  modeTimer = 0;
  const mode = MODES[modeIndex];
  modeEl.textContent = MODE_NAMES[mode];
  mirrorFrame.hidden = mode !== 'pov';
}

function nextMode(): void {
  autoCycle = false;
  setMode((modeIndex + 1) % MODES.length);
}

canvas.addEventListener('click', nextMode);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') nextMode();
  if (e.code === 'KeyM') {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.8;
  }
});

$('go').addEventListener('click', () => {
  $('start').hidden = true;
  startAudio();
  setMode(0);
});

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  cam.aspect = w / Math.max(h, 1);
  cam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
setMode(1);

// Анимация
const clock = new THREE.Clock();
let t = 0;
let killerX = 0;
let phase = 0;
let flash = 0;
let nextFlash = 5 + Math.random() * 6;

function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  const speed = 30 + Math.sin(t * 0.23) * 4;

  for (const m of movers) {
    m.position.z += speed * dt;
    if (m.position.z > BACK) m.position.z -= SPAN;
  }

  const carX = Math.sin(t * 0.35) * 1.4 + Math.sin(t * 1.1) * 0.25;
  car.position.set(carX, Math.sin(t * 9) * 0.015, 0);
  car.rotation.y = -Math.cos(t * 0.35) * 0.05;
  for (const w of wheels) w.rotation.x -= (speed * dt) / 0.4;
  steering.rotation.z = Math.cos(t * 0.35) * 0.5;

  const lunge = Math.pow(Math.max(0, Math.sin(t * 0.42 - 1)), 8) * 7.5;
  const killerDist = 11 + Math.sin(t * 0.3) * 3 - lunge;
  killerX += (carX - killerX) * Math.min(1, dt * 1.5);
  phase += dt * 13;
  killer.position.set(killerX, Math.abs(Math.sin(phase)) * 0.12, 2.2 + killerDist);
  killer.rotation.set(-0.18, (carX - killerX) * 0.15, 0);
  legL.rotation.x = Math.sin(phase) * 0.85;
  legR.rotation.x = -Math.sin(phase) * 0.85;
  armL.rotation.x = -Math.sin(phase) * 0.9;
  armR.rotation.x = 2.6 + Math.sin(phase * 2) * (killerDist < 5 ? 0.45 : 0.15);
  eyeMat.color.setRGB(1, 0.12 + 0.1 * Math.sin(t * 20), 0.05);

  for (const lamp of lamps) {
    if (!lamp.flicker) continue;
    const on = Math.sin(t * 7.3 + lamp.seed) + Math.sin(t * 17.1 + lamp.seed * 2) > -1.1;
    lamp.light.intensity = on ? 30 : 1.5;
    lamp.bulb.emissiveIntensity = on ? 2 : 0.1;
    lamp.beam.visible = on;
  }

  nextFlash -= dt;
  if (nextFlash <= 0) {
    flash = 1;
    nextFlash = 7 + Math.random() * 10;
    thunder();
  }
  flash = Math.max(0, flash - dt * 2.2);
  const f = flash > 0.65 || (flash > 0.25 && flash < 0.4) ? flash : flash * 0.25;
  hemi.intensity = 0.4 + f * 4;
  bg.copy(NIGHT).lerp(FLASH, f * 0.6);
  fog.color.copy(bg);

  if (autoCycle) {
    modeTimer += dt;
    if (modeTimer > 8) setMode((modeIndex + 1) % MODES.length);
  }
  const mode = MODES[modeIndex];
  const kz = killer.position.z;
  const danger = THREE.MathUtils.clamp((8 - killerDist) / 6, 0, 1);
  const shake = 0.006 + danger * 0.035;
  if (mode === 'pov') {
    cam.position.set(carX - 0.4 + (Math.random() - 0.5) * shake, 1.33 + car.position.y + (Math.random() - 0.5) * shake, 0.05);
    cam.lookAt(carX - 0.4 + Math.sin(t * 0.35) * 0.6, 1.15, -20);
  } else if (mode === 'front') {
    cam.position.set(carX + 2.4, 1.5, -7.5);
    cam.lookAt(carX, 1.2, kz * 0.55);
  } else if (mode === 'chase') {
    cam.position.set(killerX + 1.6, 2.8, kz + 6);
    cam.lookAt(carX, 1.0, -1);
  } else {
    cam.position.set(carX + 7.5, 1.3, kz * 0.5);
    cam.lookAt(carX, 1.1, kz * 0.5);
  }
  rearCam.position.set(carX, 1.4, 0.9);
  rearCam.lookAt(carX, 1.2, 30);

  speedEl.textContent = 'Скорость: ' + Math.round(speed * 4.2) + ' км/ч';
  const close = killerDist < 5;
  distEl.textContent = close ? 'ОН ДОГОНЯЕТ! ' + killerDist.toFixed(1) + ' м' : 'Убийца сзади: ' + killerDist.toFixed(1) + ' м';
  distEl.classList.toggle('danger', close);

  if (audio && master) {
    engine[0].frequency.value = 40 + speed * 0.5;
    engine[1].frequency.value = 80 + speed * 1.0;
    const interval = THREE.MathUtils.clamp(0.35 + ((killerDist - 2) / 12) * 0.65, 0.35, 1.0);
    if (audio.currentTime >= nextBeat) {
      const at = Math.max(nextBeat, audio.currentTime + 0.01);
      thump(at, 0.7);
      thump(at + 0.16, 0.45);
      nextBeat = at + interval;
    }
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, cam);
  if (mode === 'pov') {
    const mw = Math.round(w * 0.3);
    const mh = Math.round(h * 0.13);
    const mx = Math.round((w - mw) / 2);
    const my = h - mh - Math.round(h * 0.04);
    rearCam.aspect = mw / Math.max(mh, 1);
    rearCam.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setScissor(mx, my, mw, mh);
    renderer.setViewport(mx, my, mw, mh);
    renderer.render(scene, rearCam);
    renderer.setScissorTest(false);
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
