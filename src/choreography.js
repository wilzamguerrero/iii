/**
 * Coreografía del vuelo.
 *
 * Cinco actos encadenados sin cortes:
 *   enter   el avión llega desde el fondo, en una S descendente
 *   pass    sigue de largo rozando la frase, que sube en su estela, y se va
 *   gone    fuera de cuadro; la frase se queda sola y legible
 *   attack  vuelve a entrar por el lado por donde salió y la barre
 *   charge  el relevo: otro avión viene del fondo al frente y entrega el menú
 *
 * Nunca se detiene ni gira en seco: cada acto arranca con la posición y la
 * dirección con que terminó el anterior.
 *
 * El alabeo no se anima a mano: se deduce de la curvatura de la trayectoria
 * (roll proporcional a la velocidad de giro), que es lo que hace que un vuelo
 * en CG deje de parecer un objeto arrastrado por un raíl.
 */

import * as THREE from "three";
import { PaperPlane, makePaperMaterial, makePaperTexture } from "./origami.js";
import { clamp, damp, ease, noise1, rng, smoothstep } from "./utils.js";

export const TIME = {
  enter: 3.7,      // del fondo hasta la cabecera de la frase
  pass: 2.5,       // la pasada rozando el texto y la salida de cuadro
  attackDur: 1.85, // el barrido
  chargeDur: 2.7,  // el relevo, del fondo al frente
};

/**
 * Sentido del barrido en x. El héroe sale de cuadro por el lado contrario y
 * vuelve a entrar por ahí mismo, así que negar esto invierte los tres actos
 * de golpe: la salida, la reentrada y hacia dónde vuelan las palabras.
 */
const SWEEP = -1;

/** Cuál de los acompañantes rompe la formación y da el relevo. */
const RELAY = 1;

const HERO_SCALE = 0.66;

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

    // Llegada: del fondo hasta justo antes de la primera palabra.
    this.entry = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-9.8 * -SWEEP, 4.4, -25),
        new THREE.Vector3(-6.6 * -SWEEP, 3.2, -17),
        new THREE.Vector3(-4.9 * -SWEEP, 1.85, -9.2),
        new THREE.Vector3(-4.4 * -SWEEP, 1.05, -3.6),
      ],
      false, "centripetal", 0.5
    );

    // Pasada: roza la línea de texto de un extremo a otro y sigue hasta salir
    // de cuadro. Es el mismo trazo, sin frenar: la frase sube en su estela.
    this.passPath = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-4.4 * -SWEEP, 1.05, -3.6),
        new THREE.Vector3(-3.3 * -SWEEP, 0.8, -1.95),
        new THREE.Vector3(0, 0.76, -1.75),
        new THREE.Vector3(3.4 * -SWEEP, 0.84, -1.95),
        new THREE.Vector3(7.4 * -SWEEP, 1.35, -2.8),
        new THREE.Vector3(14.5 * -SWEEP, 2.6, -5.0),
      ],
      false, "centripetal", 0.5
    );

    // El héroe arranca ya colocado en el inicio de la curva. Sin esto, el
    // primer fotograma que se dibuje antes del primer tick lo muestra en el
    // origen y de morro: dos alas sueltas en el centro de la página.
    this.entry.getPointAt(0, this.pos);
    this.hero.mesh.position.copy(this.pos);
    this.entry.getPointAt(0.2, _v1);
    this.hero.mesh.lookAt(_v1);

    this.state = "enter";
    this.stateT = 0;
    this.attack = null;
    this.charge = null;
    this.relay = this.companions[RELAY];
    this.relayPos = new THREE.Vector3();
    this.trailSrc = null;
    /** Instante absoluto del barrido. Lo fija quien sabe cuánto dura la frase. */
    this.sweepAt = Infinity;
    this.flashed = false;
    this.baseFov = stage.camera.fov;

    this.screen = { x: 0, y: 0, vx: 0, vy: 0, valid: false };
    this._prev = { x: 0, y: 0, valid: false };
  }

  /** Sólo el barrido mueve palabras: la pasada de la llegada las deja intactas. */
  get sweeping() {
    return this.state === "attack";
  }

  /** Sentido del barrido, para que la frase sepa hacia dónde caer. */
  get sweepDir() {
    return SWEEP;
  }

  /**
   * Velocidad media en pantalla de la pasada, en px/s. La instantánea no sirve
   * de referencia: en el momento del disparo el avión viene casi de frente y
   * apenas se desplaza en x, aunque medio segundo después cruce todo el cuadro.
   */
  passRate() {
    const { camera, size } = this.stage;
    const at = (p) => {
      this.passPath.getPointAt(Choreography.passEase(p), _v1);
      return _v1.project(camera).x * 0.5 * size.w;
    };
    const a = 0.12;
    const b = 0.62; // el tramo que cruza el texto
    return Math.abs(at(b) - at(a)) / ((b - a) * TIME.pass);
  }

  /**
   * A punto de barrer: hay que congelar la maquetación antes, no en caliente.
   * Con movimiento reducido no hay barrido, así que tampoco hay que congelar
   * nada: la frase se va como vino y conviene que siga siendo texto en flujo.
   */
  armed(t) {
    return !this.reduced && this.state === "gone" && t >= this.sweepAt - 0.6;
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

  /**
   * Vuelve a entrar por donde salió, cae sobre la línea y la barre. Los puntos
   * van escritos como si el barrido fuese hacia +x; SWEEP los refleja.
   */
  buildAttack() {
    const p = this.pos.clone();
    const d = this.heroFlyer.dir.clone().multiplyScalar(1.6);
    this.attack = new THREE.CatmullRomCurve3(
      [
        p,
        p.clone().add(d),
        new THREE.Vector3(-7.5 * SWEEP, 1.4, 0.4),
        new THREE.Vector3(-3.0 * SWEEP, 0.06, 1.45),
        new THREE.Vector3(1.2 * SWEEP, -0.05, 1.5),
        new THREE.Vector3(4.6 * SWEEP, 0.5, 1.1),
        new THREE.Vector3(5.9 * SWEEP, 1.5, -1.2),
        new THREE.Vector3(10.5 * SWEEP, 2.6, -3.4),
      ],
      false, "centripetal", 0.5
    );
  }

  /** El relevo rompe la formación y viene del fondo al frente. */
  buildCharge() {
    const c = this.relay;
    const p = c.plane.mesh.position.clone();
    const d = c.flyer.dir.clone().multiplyScalar(2.2);
    this.charge = new THREE.CatmullRomCurve3(
      [
        p,
        p.clone().add(d),
        new THREE.Vector3(p.x * 0.45, 1.9, -12.0),
        new THREE.Vector3(0.75, 1.1, -6.0),
        new THREE.Vector3(0.2, 0.5, -1.2),
        new THREE.Vector3(-0.1, 0.05, 3.2),
        new THREE.Vector3(-0.35, -0.3, 7.6),
      ],
      false, "centripetal", 0.5
    );
  }

  /** Acelera al acercarse: lejos apenas se mueve, cerca llena el cuadro. */
  static approachEase(p) {
    return p * (0.68 + 0.32 * p);
  }

  /**
   * Perfil de la pasada. La velocidad es una parábola con el mínimo sobre el
   * texto: entra al ritmo con que venía, cruza a paso legible y sale
   * acelerando. Nunca llega a cero — frenar es lo que hacía que pareciera
   * detenerse y arrancar de nuevo en otra dirección.
   */
  static passEase(p) {
    const a = 5;
    const m = 0.3;
    const k = (x) => x + (a * ((x - m) ** 3 + m ** 3)) / 3;
    return k(p) / k(1);
  }

  /**
   * El relevo se quita de encima la distancia larga y llega grande con tiempo
   * de sobra. Lo que se nota en pantalla no es la velocidad, es el tamaño, y el
   * tamaño va con la inversa de la distancia: avanzando a ritmo parejo el avión
   * se queda diminuto casi hasta el final y el acercamiento entero se resuelve
   * en dos fotogramas. Arranca deprisa, entre la niebla, y se abre despacio.
   */
  static chargeEase(p) {
    return 0.88 * ease.outQuad(p) + 0.12 * p;
  }

  update(t, dt) {
    this.stateT += dt;

    switch (this.state) {
      case "enter": {
        const p = clamp(this.stateT / TIME.enter, 0, 1);
        this.entry.getPointAt(Choreography.approachEase(p), this.pos);
        // Sin corte: la pasada arranca donde acaba la llegada y con su rumbo.
        if (p >= 1) {
          this.state = "pass";
          this.stateT = 0;
        }
        break;
      }
      case "pass": {
        const p = clamp(this.stateT / TIME.pass, 0, 1);
        this.passPath.getPointAt(Choreography.passEase(p), this.pos);
        if (p >= 1) {
          this.state = "gone";
          this.stateT = 0;
        }
        break;
      }
      case "gone": {
        // Fuera de cuadro. La frase se lee sola; el avión espera su turno.
        if (!this.reduced && t >= this.sweepAt) {
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
          this.hero.mesh.visible = false;
          this.buildCharge();
          this.state = "charge";
          this.stateT = 0;
        }
        break;
      }
      case "charge": {
        const p = clamp(this.stateT / TIME.chargeDur, 0, 1);
        const c = this.relay;
        this.charge.getPointAt(Choreography.chargeEase(p), this.relayPos);
        c.plane.mesh.visible = true;
        c.flyer.orient(c.plane.mesh, this.relayPos, dt, { extraRoll: p * 0.85 });
        c.plane.flutter(t, 0.4 + p * 1.6);
        this.trail(c.plane.mesh, clamp((c.flyer.speed - 5) / 20, 0, 1));
        if (!this.flashed && this.relayPos.distanceTo(this.stage.camera.position) < 1.25) {
          this.flashed = true;
          this.onFlash();
        }
        if (p >= 1) this.finish();
        break;
      }
      default:
        break;
    }

    if (this.state !== "done" && this.state !== "charge") {
      const sway = noise1(t * 0.7 + 1.3, 4) * 0.05;
      this.heroFlyer.orient(this.hero.mesh, this.pos, dt, { sway });
      this.updateScreen(dt);

      const fast = clamp((this.heroFlyer.speed - 5) / 20, 0, 1);
      this.hero.flutter(t, 0.35 + fast * 1.5);
      this.trail(this.hero.mesh, fast);
    }

    this.updateCompanions(t, dt);
    this.updateCamera(t, dt);
  }

  /** La estela sigue al avión que manda en cada acto. */
  trail(mesh, fast) {
    // Sin sembrar el anillo, los primeros 18 fotogramas leen ranuras vacías y
    // las estelas salen apiladas en el origen: un borrón fijo en la pantalla.
    // Lo mismo al cambiar de avión, de ahí que el relevo lo vuelva a sembrar.
    if (!this.histReady || this.trailSrc !== mesh) {
      for (const slot of this.hist) {
        slot.p.copy(mesh.position);
        slot.q.copy(mesh.quaternion);
      }
      this.histReady = true;
      this.trailSrc = mesh;
    }
    this.histHead = (this.histHead + 1) % HIST;
    const slot = this.hist[this.histHead];
    slot.p.copy(mesh.position);
    slot.q.copy(mesh.quaternion);

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
      // El relevo se pilota aparte mientras carga contra la cámara.
      if (c === this.relay && this.state === "charge") continue;
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
    if (this.state === "charge") {
      const p = clamp(this.stateT / TIME.chargeDur, 0, 1);
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
      // Vuelve a formación desde donde estaba: sin esto, el primer paso mide
      // media escena y el alabeo se dispara.
      c.flyer.primed = false;
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
