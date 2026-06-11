/* ============================================================================
   L&S — Médaillon 3D métal (Three.js)
   Sceau « Languages & Success / Start Today » en métal rose-gold PBR.
   - Reflets via environment map (RoomEnvironment, aucun fichier HDR externe)
   - Micro-rotation + parallaxe à la souris + léger flottement
   - Fallback <img> propre si WebGL indisponible
   ============================================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.getElementById('medallion-stage');
if (stage) boot(stage);

function fallback(el) {
  el.innerHTML = '<img src="assets/ls-logo.png" alt="Languages & Success" ' +
    'style="width:80%;max-width:420px;height:auto;position:absolute;left:50%;top:50%;' +
    'transform:translate(-50%,-50%);object-fit:contain" />';
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
  renderer.toneMappingExposure = 1.32;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:2';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
  camera.position.set(0, 0, 7.4);

  // ---- Reflets : environnement studio procédural -------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;

  // ---- Lumières chaudes --------------------------------------------------
  const key = new THREE.DirectionalLight(0xfff1e6, 2.4);
  key.position.set(3.5, 4.5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd8c2, 0.9);
  fill.position.set(-5, -1.5, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbe6e54, 1.6);
  rim.position.set(-2, 3, -4);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffe9da, 0.5));

  // ---- Le médaillon ------------------------------------------------------
  const medallion = new THREE.Group();
  scene.add(medallion);

  // disque (corps) — métal rose-gold brossé
  const coinGeo = new THREE.CylinderGeometry(2.05, 2.05, 0.26, 220);
  coinGeo.rotateX(Math.PI / 2); // face circulaire vers la caméra (+Z)
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xca8a6a, metalness: 1.0, roughness: 0.36 });
  const coin = new THREE.Mesh(coinGeo, coinMat);
  medallion.add(coin);

  // biseau / cerclage poli en relief (avant + arrière)
  const rimGeo = new THREE.TorusGeometry(2.02, 0.09, 40, 240);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd79b80, metalness: 1.0, roughness: 0.16 });
  const bezelF = new THREE.Mesh(rimGeo, rimMat); bezelF.position.z = 0.12; medallion.add(bezelF);
  const bezelB = new THREE.Mesh(rimGeo, rimMat); bezelB.position.z = -0.12; medallion.add(bezelB);

  // sceau gravé (le PNG transparent) — sur les deux faces
  const loader = new THREE.TextureLoader();
  loader.load('assets/ls-logo.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const sealMat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.04, depthWrite: false,
      metalness: 1.0, roughness: 0.3, emissive: 0x4a2417, emissiveMap: tex, emissiveIntensity: 0.55,
    });
    const sealF = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 3.55), sealMat);
    sealF.position.z = 0.135;
    medallion.add(sealF);
    // face arrière (orientée vers -Z) : naturellement « miroir », c'est normal pour une pièce
    const sealB = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 3.55), sealMat);
    sealB.position.z = -0.135;
    sealB.rotation.y = Math.PI;
    medallion.add(sealB);
  });

  // ---- Interaction : parallaxe souris -----------------------------------
  let px = 0, py = 0;
  window.addEventListener('pointermove', (e) => {
    px = (e.clientX / window.innerWidth) * 2 - 1;
    py = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // ---- Boucle : rotation 360° continue -----------------------------------
  const clock = new THREE.Clock();
  const SPIN = reduce ? 0 : 0.62; // rad/s ≈ 1 tour / 10 s
  function tick() {
    const t = clock.getElapsedTime();
    // tour complet sur l'axe Y (+ légère parallaxe souris)
    medallion.rotation.y = t * SPIN + px * 0.25;
    // léger basculement pour révéler l'épaisseur/relief de la pièce
    medallion.rotation.x = 0.17 + Math.sin(t * 0.5) * 0.06 + py * 0.16;
    medallion.position.y = reduce ? 0 : Math.sin(t * 0.8) * 0.05;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  // ---- Resize ------------------------------------------------------------
  const ro = new ResizeObserver(() => {
    w = el.clientWidth; h = el.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(el);
}
