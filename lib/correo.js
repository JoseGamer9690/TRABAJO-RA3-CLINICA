// Envío de correo con SMTP (por ejemplo, Gmail con contraseña de aplicación).
import nodemailer from 'nodemailer';

export async function enviarCorreo({ para, asunto, html, texto }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    // Modo demostración: sin SMTP configurado, el enlace queda en los registros de Vercel.
    console.log(`[CORREO DEMO] Para: ${para} | ${asunto}\n${texto}`);
    return { demo: true };
  }
  const transporte = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 465),
    secure: Number(SMTP_PORT || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporte.sendMail({ from: MAIL_FROM || `Huellas del Bravo <${SMTP_USER}>`, to: para, subject: asunto, html, text: texto });
  return { demo: false };
}
