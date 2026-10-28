// Desbloqueo biométrico con passkeys (WebAuthn) + extensión PRF.
// La passkey entrega un secreto solo después de Face ID / Touch ID / Windows Hello;
// de ese secreto se deriva la llave que envuelve la llave de datos del diario.
import { rand, prfKey } from './crypto.js';

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export function label() {
  if (/iPhone/.test(ua)) return 'Face ID';
  if (isIOS) return 'Face ID / Touch ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Android/.test(ua)) return 'huella';
  return 'biometría';
}

export const iconName = () => (isIOS ? 'face' : 'fingerprint');

export function fallbackNote() {
  if (isIOS) return 'Ojo: si Face ID falla, iOS puede ofrecer el código del iPhone. Eso lo decide Apple y una app web no lo puede bloquear, así que usa un código largo.';
  if (/Macintosh/.test(ua)) return 'Ojo: si Touch ID falla, macOS puede pedir la contraseña de tu usuario de la Mac en su lugar.';
  if (/Windows/.test(ua)) return 'Ojo: Windows Hello puede ofrecer el PIN de Windows como alternativa.';
  return 'El sistema puede ofrecer el bloqueo del dispositivo como alternativa.';
}

export async function supported() {
  try {
    return Boolean(window.PublicKeyCredential) && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function evaluate(credId, salt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('PRF_UNSUPPORTED');
  return out;
}

export async function enroll() {
  const salt = rand(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Diario' },
      user: { id: rand(16), name: 'Mi diario', displayName: 'Mi diario' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('PRF_UNSUPPORTED');
  const credId = new Uint8Array(cred.rawId);
  const out = ext.prf.results?.first || await evaluate(credId, salt);
  return { credId, salt, key: await prfKey(out, salt) };
}

export async function unlockKey(rec) {
  return prfKey(await evaluate(rec.credId, rec.salt), rec.salt);
}
