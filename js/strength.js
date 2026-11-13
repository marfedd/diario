// Estima la fortaleza de una contraseña como lo haría quien intenta adivinarla:
// primero palabras, nombres, años y patrones comunes, y solo después letra por
// letra. Devuelve bits aproximados (cada bit duplica los intentos necesarios).
import { WORDS } from './words.js';

const DICT = new Set(WORDS);
const WORD_BITS = Math.log2(WORDS.length);
const COMMON_BITS = 7;    // contraseñas típicas y nombres: lo primero que se prueba
const UNKNOWN_BITS = 17;  // algo que parece una palabra pero no está en la lista
const COMMON = new Set(`password contrasena clave secreto diario qwerty qwertyuiop asdf asdfgh asdfghjkl zxcvbn admin
hola teamo tequiero iloveyou amor letmein welcome bienvenido dragon monkey futbol football princesa estrella mariposa
argentina mexico espana colombia chile peru uruguay venezuela ecuador bolivia paraguay boca river barcelona madrid
messi maradona jesus dios familia felicidad corazon
jose juan maria luis carlos ana pedro martin jorge miguel pablo diego sofia lucia laura marta daniel david javier
sergio andres fernando alejandro alejandra camila valentina isabella mateo santiago nicolas lucas julia paula carmen
rosa elena antonio manuel francisco jesus angel rafael roberto ricardo eduardo alberto mario marcos tomas agustin
facundo gonzalo ignacio joaquin matias maximiliano sebastian emilia martina florencia victoria gabriela daniela
natalia andrea carolina claudia cristina patricia monica silvia beatriz isabel teresa pilar raquel sara eva ines`.split(/\s+/));
const SHORT = new Set('mi tu su se de la el en un que no si lo le me te es al del las los con por una uno mis tus sus ya yo muy mas sin hay fue son era ser ver dar dos tres mil hoy'.split(' '));
const SHORT_BITS = 5;
const LEET = { '@': 'a', 4: 'a', 0: 'o', 1: 'i', 3: 'e', 5: 's', $: 's', 7: 't' };

function wordlike(s) {
  if (s.length < 4 || /[^aeiou]{4}|[aeiou]{3}|(.)\1\1/.test(s)) return false;
  const ratio = s.replace(/[^aeiou]/g, '').length / s.length;
  return ratio >= 0.3 && ratio <= 0.65;
}

function tokenBits(raw, sub) {
  if (/^(19|20)\d\d$/.test(sub)) return 6.6;
  if (/^\d+$/.test(sub)) return null;
  if (sub.length < 4 && SHORT.has(sub)) return SHORT_BITS + (raw === sub ? 0 : 1);
  if (sub.length < 3) return null;
  const plain = sub.replace(/[@4013$57]/g, (c) => LEET[c]);
  if (!/^[a-z]+$/.test(plain)) return null;
  const leet = plain !== sub;
  const base = COMMON.has(plain) ? COMMON_BITS : DICT.has(plain) ? WORD_BITS : !leet && wordlike(plain) ? UNKNOWN_BITS : null;
  if (base == null) return null;
  const caps = raw === sub ? 0 : raw.slice(1) === sub.slice(1) || raw === raw.toUpperCase() ? 1 : 3;
  return base + (leet ? 1.5 : 0) + caps;
}

export function strength(password) {
  const t = (password || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').slice(0, 128);
  const low = t.toLowerCase();
  const n = t.length;
  if (!n) return 0;
  // Costo de un carácter suelto: según los tipos de carácter que usa la contraseña.
  const pool = (/[a-z]/.test(t) ? 26 : 0) + (/[A-Z]/.test(t) ? 26 : 0) + (/\d/.test(t) ? 10 : 0) + (/[^a-zA-Z\d ]/.test(t) ? 33 : 0);
  const charBits = Math.log2(pool || 2);
  const code = (k) => low.charCodeAt(k);
  const best = new Array(n + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    const c = low[i];
    let b = charBits;
    if (c === ' ') b = 0;
    else if (i > 1 && Math.abs(code(i) - code(i - 1)) <= 1 && code(i) - code(i - 1) === code(i - 1) - code(i - 2)) b = 1; // aaa, abc, 321
    else if (!/[a-z]/.test(c) && (i === 0 || i === n - 1)) b = Math.min(b, 3.3); // el típico "1" o "!" al final
    best[i + 1] = Math.min(best[i + 1], best[i] + b);
    for (let j = i + 2; j <= Math.min(n, i + 12); j++) {
      const cost = tokenBits(t.slice(i, j), low.slice(i, j));
      if (cost != null) best[j] = Math.min(best[j], best[i] + cost);
    }
  }
  return best[n];
}

export const MIN_BITS = 45;

export function level(bits) {
  if (bits < MIN_BITS) return { i: 1, label: 'Débil' };
  if (bits < 60) return { i: 2, label: 'Aceptable' };
  if (bits < 72) return { i: 3, label: 'Fuerte' };
  return { i: 4, label: 'Muy fuerte' };
}

// Frase de palabras elegidas con el generador aleatorio criptográfico del navegador.
// 6 palabras de una lista de 4096 = 72 bits.
export function passphrase(count = 6) {
  const r = crypto.getRandomValues(new Uint16Array(count)); // 65536 es múltiplo de 4096: sin sesgo
  return Array.from(r, (x) => WORDS[x % WORDS.length]).join(' ');
}
