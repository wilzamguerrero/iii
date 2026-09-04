/**
 * Coreografía del vuelo.
 *
 * Cuatro actos encadenados sin cortes:
 *   enter   el avión llega desde el fondo en una S descendente y se centra
 *   hover   se eleva y orbita mientras la frase se revela debajo
 *   attack  cae, encara la línea de texto y la barre de izquierda a derecha
 *   dive    sube, gira y se viene contra el objetivo hasta llenar el cuadro
 *
 * El alabeo no se anima a mano: se deduce de la curvatura de la trayectoria
 * (roll proporcional a la velocidad de giro), que es lo que hace que un vuelo
 * en CG deje de parecer un objeto arrastrado por un raíl.
 */

import * as THREE from "three";
import { PaperPlane, makePaperMaterial, makePaperTexture } from "./origami.js";
import { clamp, damp, ease, noise1, rng, smoothstep } from "./utils.js";

export const TIME = {
  enter: 3.5,
  reveal: 4.1,
  attack: 9.3,
  attackDur: 2.3,
  diveDur: 1.75,
};

const HERO_SCALE = 0.66;

const HOVER = {
  cx: 0, cy: 2.05, cz: -5.0,
  rx: 2.6, ry: 0.42, rz: 2.1,
  speed: 0.86,
  blend: 1.6,
};

/* Órbitas de reposo: lejos, pequeñas y fuera del bloque del menú. */
const AMBIENT = [
  { c: [-10.2, 3.6, -23], r: [2.2, 0.7, 2.0], scale: 0.34 },
  { c: [10.8, -3.4, -26], r: [2.4, 0.8, 2.2], scale: 0.42 },
];

const GHOST_TAPS = [
  { back: 2, opacity: 0.13 },
  { back: 4, opacity: 0.1 },
  { back: 7, opacity: 0.075 },
  { back: 10, opacity: 0.05 },
  { back: 14, opacity: 0.03 },
];
const HIST = 18;

const COMPANIONS = [
  { c: [-5.6, 2.7, -15], r: [3.4, 0.9, 3.0], speed: 0.055, born: 1.3, scale: 0.42 },
  { c: [5.9, 2.2, -18], r: [3.8, 1.1, 3.4], speed: 0.045, born: 2.0, scale: 0.5 },
  { c: [-6.2, -3.6, -13.5], r: [3.0, 0.8, 2.6], speed: 0.062, born: 2.7, scale: 0.34 },
  { c: [6.6, -4.6, -22], r: [4.2, 1.0, 3.6], speed: 0.04, born: 3.4, scale: 0.52 },
];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/** Estado de vuelo de una malla: la memoria mínima para deducir rumbo y alabeo. */
class Flyer {
  constructor() {
    this.prev = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.angle = 0;
    this.roll = 0;
    this.speed = 0;
    this.primed = false;
    this.step = new THREE.Vector3();
  }

  orient(mesh, pos, dt, { extraRoll = 0, rollGain = 0.42, sway = 0 } = {}) {
    if (!this.primed) {
      this.prev.copy(pos);
      this.angle = Math.atan2(this.dir.x, this.dir.z);
      this.primed = true;
    }

    const step = this.step.copy(pos).sub(this.prev);
    const dist = step.length();
    this.speed = dt > 0 ? dist / dt : 0;
    if (dist > 1e-5) this.dir.copy(step).normalize();

    // Alabeo a partir de la velocidad de giro en el plano horizontal.
    const angle = Math.atan2(this.dir.x, this.dir.z);
    let d = angle - this.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const turnRate = dt > 0 ? d / dt : 0;
    this.angle = angle;

    const target = clamp(-turnRate * rollGain, -1.25, 1.25);
    this.roll = damp(this.roll, target, 7, dt);

    mesh.position.copy(pos);
    mesh.lookAt(_v2.copy(pos).add(this.dir));
    mesh.rotateZ(this.roll + extraRoll + sway);
    this.prev.copy(pos);
  }
}

export class Choreography {
  constructor(stage, { reduced = false, onFlash = () => {}, ambient = true } = {}) {
    this.stage = stage;
    this.reduced = reduced;
    this.onFlash = onFlash;
    this.ambient = ambient;

    this.texture = makePaperTexture();
    this.material = makePaperMaterial(this.texture);

    this.hero = new PaperPlane(this.material, { scale: HERO_SCALE, phase: 0 });
    stage.scene.add(this.hero.mesh);
    this.heroFlyer = new Flyer();
    this.pos = new THREE.Vector3();

    // Estelas: copias del avión en fotogramas anteriores. Motion blur de
    // pobre, y justo el truco que usa el CG que se ve caro.
    this.hist = Array.from({ length: HIST }, () => ({
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }));
    this.histHead = 0;
    this.histReady = false;
    this.ghosts = GHOST_TAPS.map((tap) => {
      const m = this.material.clone();
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 0;
      const mesh = new THREE.Mesh(this.hero.geometry, m);
      mesh.scale.setScalar(HERO_SCALE);
      mesh.visible = false;
      stage.scene.add(mesh);
      return { mesh, material: m, back: tap.back, opacity: tap.opacity };
    });

    const R = rng(0x51ed);
    this.companions = COMPANIONS.map((cfg) => {
      const plane = new PaperPlane(this.material, { scale: cfg.scale, phase: R() * 6.283 });
      plane.mesh.visible = false;
      stage.scene.add(plane.mesh);
      return { cfg, plane, flyer: new Flyer(), phase: R() * 6.283, born: cfg.born, target: new THREE.Vector3() };
    });

    this.entry = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-9.5, 3.8, -26),
        new THREE.Vector3(-4.2, 2.7, -17),
        new THREE.Vector3(0.7, 1.55, -11),
        new THREE.Vector3(3.5, 0.95, -6.6),
        new THREE.Vector3(1.3, 0.55, -3.3),
        new THREE.Vector3(-1.1, 0.66, -1.6),
      ],
      false, "centripetal", 0.5
    );

    // El héroe arranca ya colocado en el inicio de la curva. Sin esto, el
    // primer fotograma que se dibuje antes del primer tick lo muestra en el
    // origen y de morro: dos alas sueltas en el centro de la página.
    this.entry.getPointAt(0, this.pos);
    this.hero.mesh.position.copy(this.pos);
    this.hero.mesh.lookAt(0.7, 1.55, -11);

    this.state = "enter";
    this.stateT = 0;
    this.hoverA = 0;
    this.hoverFrom = new THREE.Vector3();
    this.attack = null;
    this.dive = null;
    this.flashed = false;
    this.baseFov = stage.camera.fov;

    this.screen = { x: 0, y: 0, vx: 0, vy: 0, valid: false };
    this._prev = { x: 0, y: 0, valid: false };
  }

  get sweeping() {
    return this.state === "attack" || this.state === "dive";
  }

  /** Posición y velocidad del héroe en píxeles, para las físicas del texto. */
  updateScreen(dt) {
    const { camera, size } = this.stage;
    _v3.copy(this.pos).project(camera);
    const x = (_v3.x * 0.5 + 0.5) * size.w;
    const y = (-_v3.y * 0.5 + 0.5) * size.h;
    const p = this._prev;
    this.screen.vx = p.valid && dt > 0 ? (x - p.x) / dt : 0;
    this.screen.vy = p.valid && dt > 0 ? (y - p.y) / dt : 0;
    this.screen.x = x;
    this.screen.y = y;
    this.screen.valid = true;
    p.x = x; p.y = y; p.valid = true;
  }

  hoverPoint(a, out) {
    return out.set(
      HOVER.cx + HOVER.rx * Math.sin(a * 0.66),
      HOVER.cy + HOVER.ry * Math.sin(a * 1.05 + 0.7),
      HOVER.cz + HOVER.rz * Math.cos(a * 0.49)
    );
  }

  buildAttack() {
    const p = this.pos.clone();
    const d = this.heroFlyer.dir.clone().multiplyScalar(1.3);
    this.attack = new THREE.CatmullRomCurve3(
      [
        p,
        p.clone().add(d),
        new THREE.Vector3(-4.2, 2.95, -2.6),
        new THREE.Vector3(-6.5, 1.2, 0.9),
        new THREE.Vector3(-3.0, 0.06, 1.45),
        new THREE.Vector3(1.2, -0.05, 1.5),
        new THREE.Vector3(4.6, 0.5, 1.1),
        new THREE.Vector3(5.9, 1.5, -1.2),
      ],
      false, "centripetal", 0.5
    );
  }

  buildDive() {
    const p = this.pos.clone();
    const d = this.heroFlyer.dir.clone().multiplyScalar(1.5);
    this.dive = new THREE.CatmullRomCurve3(
      [
        p,
        p.clone().add(d),
        new THREE.Vector3(4.6, 3.0, -6.2),
        new THREE.Vector3(0.9, 2.2, -8.0),
        new THREE.Vector3(0.15, 1.0, -3.4),
        new THREE.Vector3(-0.15, 0.35, 1.6),
        new THREE.Vector3(-0.45, -0.15, 7.3),
      ],
      false, "centripetal", 0.5
    );
  }

  /** Primera mitad: recolocarse. Segunda: acelerar contra el objetivo. */
  static diveEase(p) {
    return p < 0.5
      ? ease.outQuad(p * 2) * 0.34
      : 0.34 + 0.66 * ease.inQuart((p - 0.5) * 2);
  }

  update(t, dt) {
    this.stateT += dt;

    switch (this.state) {
      case "enter": {
        const p = clamp(this.stateT / TIME.enter, 0, 1);
        this.entry.getPointAt(ease.outQuad(p), this.pos);
        if (p >= 1) {
          this.state = "hover";
          this.stateT = 0;
          this.hoverFrom.copy(this.pos);
        }
        break;
      }
      case "hover": {
        this.hoverA += dt * HOVER.speed;
        this.hoverPoint(this.hoverA, _v1);
        this.pos.copy(this.hoverFrom).lerp(_v1, smoothstep(0, HOVER.blend, this.stateT));
        if (!this.reduced && t >= TIME.attack) {
          this.buildAttack();
          this.state = "attack";
          this.stateT = 0;
        }
        break;
      }
      case "attack": {
        const p = clamp(this.stateT / TIME.attackDur, 0, 1);
        this.attack.getPointAt(ease.inOutQuint(p), this.pos);
        if (p >= 1) {
          this.buildDive();
          this.state = "dive";
          this.stateT = 0;
        }
        break;
      }
      case "dive": {
        const p = clamp(this.stateT / TIME.diveDur, 0, 1);
        this.dive.getPointAt(Choreography.diveEase(p), this.pos);
        if (!this.flashed && this.pos.distanceTo(this.stage.camera.position) < 1.25) {
          this.flashed = true;
          this.onFlash();
        }
        if (p >= 1) this.finish();
        break;
      }
      default:
        break;
    }

    if (this.state !== "done") {
      const sway = noise1(t * 0.7 + 1.3, 4) * 0.05;
      const p = clamp(this.stateT / TIME.diveDur, 0, 1);
      const extraRoll = this.state === "dive" ? p * 0.85 : 0;
      this.heroFlyer.orient(this.hero.mesh, this.pos, dt, { extraRoll, sway });
      this.updateScreen(dt);

      const fast = clamp((this.heroFlyer.speed - 5) / 20, 0, 1);
      this.hero.flutter(t, 0.35 + fast * 1.5);
      this.pushHistory(fast);
    }

    this.updateCompanions(t, dt);
    this.updateCamera(t, dt);
  }

  pushHistory(fast) {
    // Sin esto los primeros 18 fotogramas leen ranuras vacías y las estelas
    // aparecen apiladas en el origen: un borrón fijo en mitad de la pantalla.
    if (!this.histReady) {
      for (const slot of this.hist) {
        slot.p.copy(this.hero.mesh.position);
        slot.q.copy(this.hero.mesh.quaternion);
      }
      this.histReady = true;
    }
    this.histHead = (this.histHead + 1) % HIST;
    const slot = this.hist[this.histHead];
    slot.p.copy(this.hero.mesh.position);
    slot.q.copy(this.hero.mesh.quaternion);

    for (const g of this.ghosts) {
      const src = this.hist[(this.histHead - g.back + HIST * 2) % HIST];
      const o = g.opacity * fast;
      g.material.opacity = o;
      g.mesh.visible = o > 0.004;
      if (g.mesh.visible) {
        g.mesh.position.copy(src.p);
        g.mesh.quaternion.copy(src.q);
      }
    }
  }

  updateCompanions(t, dt) {
    for (const c of this.companions) {
      const { cfg, plane, flyer } = c;
      const alive = t > c.born;
      plane.mesh.visible = alive;
      if (!alive) continue;

      const a = (t - c.born) * cfg.speed * 6.283 + c.phase;
      c.target.set(
        cfg.c[0] + cfg.r[0] * Math.sin(a),
        cfg.c[1] + cfg.r[1] * Math.sin(a * 1.7 + c.phase),
        cfg.c[2] + cfg.r[2] * Math.cos(a)
      );
      plane.mesh.scale.setScalar(cfg.scale * smoothstep(0, 0.9, t - c.born));
      flyer.orient(plane.mesh, c.target, dt, {
        rollGain: 0.5,
        sway: noise1(t * 0.5, c.phase) * 0.08,
      });
      plane.flutter(t, 0.5);
    }
  }

  updateCamera(t, dt) {
    const cam = this.stage.camera;
    // Deriva de cámara en mano: apenas perceptible, imprescindible.
    const drift = this.reduced ? 0.25 : 1;
    cam.position.x = noise1(t * 0.11, 1) * 0.09 * drift;
    cam.position.y = 0.2 + noise1(t * 0.13, 2) * 0.065 * drift;

    let fov = this.baseFov;
    let z = 6.4;
    if (this.state === "dive") {
      const p = clamp(this.stateT / TIME.diveDur, 0, 1);
      const k = ease.inQuad(clamp((p - 0.45) / 0.55, 0, 1));
      fov = this.baseFov + k * 12; // dolly-zoom al pasar el avión junto al objetivo
      z = 6.4 + k * 0.45;
    }
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = damp(cam.fov, fov, 9, dt);
      cam.updateProjectionMatrix();
    }
    cam.position.z = damp(cam.position.z, z, 9, dt);
    cam.lookAt(0, 0.05, 0);
    cam.rotation.z += noise1(t * 0.09, 3) * 0.005 * drift;
  }

  /** Fin del intro: el héroe desaparece y sólo queda el fondo respirando. */
  finish() {
    if (this.state === "done") return;
    this.state = "done";
    this.hero.mesh.visible = false;
    for (const g of this.ghosts) {
      g.mesh.visible = false;
      g.material.opacity = 0;
    }
    this.companions.forEach((c, i) => {
      if (!this.ambient || i > 1) {
        c.plane.mesh.visible = false;
        c.born = Infinity;
        return;
      }
      const amb = AMBIENT[i];
      c.cfg = { ...c.cfg, c: amb.c, r: amb.r, scale: amb.scale };
    });
    const cam = this.stage.camera;
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
  }

  dispose() {
    this.hero.dispose();
    this.companions.forEach((c) => c.plane.dispose());
    this.ghosts.forEach((g) => g.material.dispose());
    this.material.dispose();
    this.texture.dispose();
  }
}
