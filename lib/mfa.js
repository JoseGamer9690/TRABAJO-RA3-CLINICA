// Autenticación multifactor con TOTP (Google Authenticator, Microsoft Authenticator, etc.).
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { cifrar, descifrar } from './auth.js';

const crearTotp = (secretoBase32, usuario) => new OTPAuth.TOTP({
  issuer: 'Huellas del Bravo', label: usuario, algorithm: 'SHA1', digits: 6, period: 30,
  secret: OTPAuth.Secret.fromBase32(secretoBase32),
});

export async function nuevoSecreto(usuario) {
  const secreto = new OTPAuth.Secret({ size: 20 }).base32;
  const uri = crearTotp(secreto, usuario).toString();
  return { secreto, cifrado: cifrar(secreto), qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

export function totpValido(secretoCifrado, codigo, usuario) {
  if (!secretoCifrado) return false;
  const token = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  return crearTotp(descifrar(secretoCifrado), usuario).validate({ token, window: 1 }) !== null;
}
