/**
 * Montaje de la escena: fotografía de estudio sobre fondo blanco.
 *
 * El canvas es transparente y el blanco lo pone el CSS, así que no se aplica
 * tone mapping: el papel se lee por su sombreado, no por su brillo. La niebla
 * blanca hace de perspectiva aérea — lo lejano se disuelve en la página.
 */

import * as THREE from "three";
import { clamp, lerp } from "./utils.js";

/** Entorno de iluminación: degradado cielo→suelo convolucionado con PMREM. */
function studioEnvironment(renderer) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 128;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, "#ffffff");
  g.addColorStop(0.46, "#f6f8fb");
  g.addColorStop(0.54, "#e7ecf3");
  g.addColorStop(1.0, "#cbd3de");
  x.fillStyle = g;
  x.fillRect(0, 0, 16, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return rt;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0xffffff, 0);
  // Sin sombras: en un vacío blanco cualquier sombra proyectada se lee como
  // un objeto más, no como profundidad. El relieve lo dan los pliegues.
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 11, 40);

  const envRT = studioEnvironment(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.08, 120);
  camera.position.set(0, 0.2, 6.4);
  camera.lookAt(0, 0, 0);

  // Relleno bicolor: cielo neutro arriba, rebote frío abajo. Es lo que evita
  // que un blanco sobre blanco se vea plano sin llegar a teñir el papel.
  const fill = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xe6edf6, 0.6);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfffdf8, 0.95);
  key.position.set(7.6, 4.4, 4.2);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xe9f1ff, 0.28);
  rim.position.set(-6.8, -0.6, -3.2);
  scene.add(rim);

  const size = { w: 1, h: 1, dpr: 1 };

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    size.w = w;
    size.h = h;
    size.dpr = dpr;

    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    const aspect = w / h;
    camera.aspect = aspect;
    // En vertical se abre el campo para que la coreografía siga cabiendo.
    camera.fov = lerp(51, 37, clamp((aspect - 0.55) / 1.25, 0, 1));
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    envRT.dispose();
    renderer.dispose();
  }

  resize();
  return { renderer, scene, camera, lights: { fill, hemi, key, rim }, size, resize, render, dispose };
}
