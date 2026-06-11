/* ============================================================================
   L&S — Logo en SPHÈRE 3D (Three.js)
   Sphère glossy rose-gold (non métallique) avec le sceau « Languages & Success »
   imprimé dessus, éclairée et en rotation continue. Rendue par-dessus le nuage de
   particules (morph.js). Fallback <img> propre si WebGL indisponible.
   ============================================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.getElementById('medallion-stage');
if (stage) boot(stage);

function fallback(el) {
  const img = document.createElement('img');
  img.src = 'assets/ls-logo.png';
  img.alt = 'Languages & Success';
  img.style.cssText = 'position:absolute;left:50%;top:50%;width:60%;transform:translate(-50%,-50%);object-fit:contain;z-index:2';
  el.appendChild(img);
}

function boot(el) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { fallback(el); return; }
  if (!renderer.getContext()) { fallback(el); return; }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = el.clientWidth || 480;
  let h = el.clientHeight || 460;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:2';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
  camera.position.set(0, 0, 7.4);

  // reflets studio procéduraux (aucun fichier externe)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // lumières chaudes
  const key = new THREE.DirectionalLight(0xfff1e6, 2.2); key.position.set(3.5, 4.5, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd8c2, 0.8); fill.position.set(-5, -1.5, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbe6e54, 1.5); rim.position.set(-2, 3, -4); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffe9da, 0.45));

  // ---- texture de la sphère : fond rose-gold + sceau imprimé --------------
  function buildTexture(logoImg) {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const g = c.getContext('2d');
    // fond rose-gold dégradé doux
    const grad = g.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0.00, '#f6d2bd');
    grad.addColorStop(0.45, '#e3ad90');
    grad.addColorStop(1.00, '#b9785b');
    g.fillStyle = grad; g.fillRect(0, 0, 2048, 1024);
    // sceau sur la face avant (u=0.5) et au dos (u=0 et u=1, raccord de la couture)
    const lw = 760, lh = 760, cy = 512 - lh / 2;
    g.drawImage(logoImg, 1024 - lw / 2, cy, lw, lh);          // avant
    g.drawImage(logoImg, 0 - lw / 2, cy, lw, lh);             // dos (gauche de la couture)
    g.drawImage(logoImg, 2048 - lw / 2, cy, lw, lh);          // dos (droite de la couture)
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.05, 128, 128),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.15, roughness: 0.42,
      clearcoat: 0.7, clearcoatRoughness: 0.28,
      sheen: 0.4, sheenColor: 0xffe2c8,
    })
  );
  sphere.rotation.x = 0.16; // léger basculement pour bien lire le volume
  scene.add(sphere);

  // applique la texture une fois le logo chargé
  const loaderImg = new Image();
  loaderImg.crossOrigin = 'anonymous';
  loaderImg.onload = () => {
    const tex = buildTexture(loaderImg);
    sphere.material.map = tex;
    sphere.material.needsUpdate = true;
  };
  loaderImg.src = 'assets/ls-logo.png';

  // ---- boucle : rotation continue ----------------------------------------
  const clock = new THREE.Clock();
  const SPIN = reduce ? 0 : 0.42; // rad/s
  let visible = true, running = true;
  function tick() {
    if (!visible) { running = false; return; }
    const t = clock.getElapsedTime();
    sphere.rotation.y = t * SPIN;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  // pause hors-écran
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !running) { running = true; requestAnimationFrame(tick); }
    }, { threshold: 0.01 });
    io.observe(el);
  }

  // resize
  const ro = new ResizeObserver(() => {
    w = el.clientWidth; h = el.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(el);
}
