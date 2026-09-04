/**
 * El avión de papel.
 *
 * Geometría plegada a mano (8 caras, sin índices) para que cada pliegue tenga
 * su propia normal y su propia luz. La nariz apunta a +Z, que es la dirección
 * que Object3D.lookAt() alinea con el objetivo.
 *
 *            +Y
 *             |        alerón plegado hacia arriba
 *             |      /
 *   ala ______|_____/            nariz (N) --> +Z
 *             |
 *             |  quilla (dos capas de papel a ±0.014 en X)
 */

import * as THREE from "three";

/* Vértices del dardo, en unidades de escena. */
const N = [0.0, 0.0, 1.58]; // nariz
const C = [0.0, 0.0, -1.04]; // vértice trasero del pliegue central
const K = [0.0, -0.38, -0.78]; // base trasera de la quilla
const W = [0.8, 0.17, -1.0]; // punta del ala (arranque del alerón)
const FOLD_T = 0.56; // dónde nace el pliegue del alerón sobre el borde N→W
const OFF = [0.16, 0.25, 0.0]; // desplazamiento del alerón: afuera y arriba

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mirrorX = (p) => [-p[0], p[1], p[2]];
const shiftX = (p, dx) => [p[0] + dx, p[1], p[2]];

/** Oclusión falsa horneada en color de vértice: los valles del pliegue son más oscuros. */
function shadeFor(kind, p) {
  if (kind === "wing") return 0.965 + 0.035 * Math.min(1, Math.abs(p[0]) / 0.8);
  if (kind === "winglet") return 0.99;
  return 0.925 + 0.065 * Math.min(1, -p[1] / 0.38); // quilla
}

export function buildPlaneGeometry() {
  const pos = [];
  const uv = [];
  const col = [];

  const tri = (a, b, c, kind) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      uv.push((p[0] + 1.15) / 2.3, (p[2] + 1.6) / 3.2);
      const s = shadeFor(kind, p);
      col.push(s, s, s);
    }
  };

  const WR = W;
  const WL = mirrorX(W);
  const FR = mix(N, WR, FOLD_T);
  const FL = mirrorX(FR);
  const TFR = add(FR, OFF);
  const TR = add(WR, OFF);
  const TFL = mirrorX(TFR);
  const TL = mirrorX(TR);

  // Alas (normal hacia +Y)
  tri(N, WR, C, "wing");
  tri(N, C, WL, "wing");

  // Alerones plegados
  tri(FR, WR, TR, "winglet");
  tri(FR, TR, TFR, "winglet");
  tri(FL, TL, WL, "winglet");
  tri(FL, TFL, TL, "winglet");

  // Quilla: dos capas de papel separadas lo justo para que el pliegue se lea
  const d = 0.014;
  tri(shiftX(N, d), shiftX(K, d), shiftX(C, d), "keel");
  tri(shiftX(N, -d), shiftX(C, -d), shiftX(K, -d), "keel");

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Textura de papel: fibra, granulado y manchas suaves. Sirve de bump y de rugosidad. */
export function makePaperTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d");

  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, S, S);

  // Manchas de gramaje
  for (let i = 0; i < 90; i++) {
    const r = 20 + Math.random() * 110;
    const g = x.createRadialGradient(
      Math.random() * S, Math.random() * S, 0,
      Math.random() * S, Math.random() * S, r
    );
    g.addColorStop(0, "rgba(0,0,0,0.018)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }

  // Fibra de celulosa
  x.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const px = Math.random() * S;
    const py = Math.random() * S;
    const a = Math.random() * Math.PI;
    const len = 2 + Math.random() * 12;
    x.strokeStyle = `rgba(0,0,0,${0.012 + Math.random() * 0.03})`;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }

  // Granulado fino
  const img = x.getImageData(0, 0, S, S);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    px[i] += n;
    px[i + 1] += n;
    px[i + 2] += n;
  }
  x.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.7, 1.7);
  tex.colorSpace = THREE.NoColorSpace; // datos, no color
  tex.anisotropy = 4;
  return tex;
}

export function makePaperMaterial(paperTex) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf6f8fb,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.3,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffffff),
    side: THREE.DoubleSide,
    flatShading: true,
    bumpMap: paperTex,
    bumpScale: 0.14,
    roughnessMap: paperTex,
    envMapIntensity: 1.05,
  });
}

/**
 * Un avión: malla + aleteo del papel.
 * El aleteo se calcula en CPU (24 vértices) para no tocar el shader.
 */
export class PaperPlane {
  constructor(material, { scale = 1, phase = 0 } = {}) {
    this.geometry = buildPlaneGeometry();
    this.base = Float32Array.from(this.geometry.attributes.position.array);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.scale.setScalar(scale);
    this.mesh.matrixAutoUpdate = true;
    this.phase = phase;
    this.flutterAmount = 0.35;
  }

  /** amount 0 = papel quieto, 1 = papel batiendo a fondo. */
  flutter(t, amount = this.flutterAmount) {
    const p = this.geometry.attributes.position.array;
    const b = this.base;
    const ph = this.phase;
    for (let i = 0; i < p.length; i += 3) {
      const bx = b[i], by = b[i + 1], bz = b[i + 2];
      const ax = Math.min(1, Math.abs(bx) / 0.98);
      const w = ax * ax * (3 - 2 * ax); // solo las puntas vibran
      const wave =
        Math.sin(t * 8.4 + bz * 2.15 + ph) * 0.62 +
        Math.sin(t * 13.9 - bz * 3.35 + ph * 1.9) * 0.38;
      p[i] = bx;
      p[i + 1] = by + wave * 0.062 * w * amount;
      p[i + 2] = bz + wave * 0.012 * w * amount;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
  }
}
