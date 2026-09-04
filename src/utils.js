/**
 * Utilidades de movimiento: curvas de aceleración, amortiguación y ruido.
 * Nada de easings por defecto — el carácter de la animación vive aquí.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));

export function smoothstep(a, b, v) {
  const t = inv(a, b, v);
  return t * t * (3 - 2 * t);
}

/** Interpolación exponencial independiente del framerate. */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export const ease = {
  outQuad:  (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo:  (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inQuad:   (t) => t * t,
  inCubic:  (t) => t * t * t,
  inQuart:  (t) => t * t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
  /** Aterrizaje largo: entra rápido y se posa sin rebote. */
  settle: (t) => 1 - Math.pow(1 - t, 3.4) * Math.cos(t * 0.9),
};

/**
 * Ruido 1D continuo y barato (suma de senos con frecuencias inconmensurables).
 * Suficiente para deriva de cámara y respiración del papel.
 */
export function noise1(t, seed = 0) {
  return (
    Math.sin(t * 1.000 + seed * 1.7) * 0.5 +
    Math.sin(t * 2.137 + seed * 3.1) * 0.28 +
    Math.sin(t * 4.518 + seed * 5.9) * 0.14 +
    Math.sin(t * 8.911 + seed * 9.3) * 0.08
  );
}

/** PRNG determinista: la coreografía se repite igual en cada carga. */
export function rng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
