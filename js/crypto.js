// Cifrado del diario.
// - Llave de datos (DEK): AES-256-GCM aleatoria, cifra todas las entradas y fotos.
// - La DEK se guarda "envuelta" con una llave derivada de la contraseña maestra
//   (Argon2id) y, opcionalmente, con una llave derivada de una passkey (WebAuthn PRF).
// - Cada archivo se cifra con su nombre como dato asociado (AAD), así no se pueden
//   intercambiar archivos entre sí sin que falle la verificación.

const te = new TextEncoder();
const td = new TextDecoder();
const FORMAT = 1;

export const KDF_DEFAULT = { alg: 'argon2id', m: 65536, t: 3, p: 1 }; // 64 MiB, 3 pasadas

export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export function toB64(bytes) {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export async function passwordKey(password, kdf) {
  if (kdf.alg !== 'argon2id' || kdf.m < 19456 || kdf.m > 1048576 || kdf.t < 2 || kdf.t > 20) {
    throw new Error('Parámetros de cifrado no válidos');
  }
  const raw = await globalThis.hashwasm.argon2id({
    password: te.encode(password.normalize('NFC')),
    salt: fromB64(kdf.salt),
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  });
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
  } finally {
    raw.fill(0);
  }
}

export async function prfKey(prfOutput, salt) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('diario/bio-kek/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

// Extraíble solo para poder volver a envolverla (cambio de contraseña, biometría).
export const newDataKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrap(dek, kek) {
  const iv = rand(12);
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: te.encode('diario/dek') });
  return toB64(iv) + '.' + toB64(ct);
}

export async function unwrap(wrapped, kek) {
  const [iv, ct] = wrapped.split('.').map(fromB64);
  return crypto.subtle.unwrapKey(
    'raw', ct, kek,
    { name: 'AES-GCM', iv, additionalData: te.encode('diario/dek') },
    { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'],
  );
}

export async function seal(dek, bytes, name) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(name) }, dek, bytes));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = FORMAT;
  out.set(iv, 1);
  out.set(ct, 13);
  return out.buffer;
}

export async function open(dek, buf, name) {
  const u = new Uint8Array(buf);
  if (u[0] !== FORMAT) throw new Error('Formato desconocido');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: te.encode(name) }, dek, u.subarray(13));
}

// El JSON se rellena con espacios hasta múltiplos de 512 bytes para no revelar
// el largo exacto de cada texto.
export function sealJSON(dek, obj, name) {
  let s = JSON.stringify(obj);
  s += ' '.repeat((512 - (te.encode(s).length % 512)) % 512);
  return seal(dek, te.encode(s), name);
}

export async function openJSON(dek, buf, name) {
  return JSON.parse(td.decode(await open(dek, buf, name)));
}
