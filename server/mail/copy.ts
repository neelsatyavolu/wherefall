import { z } from 'zod';
import type { EmailCopy } from './template.js';

/** What the site's emails say, in each language the site comes in. The pages have their own catalogs, in src/i18n. */

const APP = 'Wherefall';

/** Who every email is from. The domain is verified in Resend. */
export const MAIL_FROM = `${APP} <no-reply@n3el.dev>`;

/** The languages of the site, as src/i18n has them. */
export const MAIL_LANGUAGES = ['en', 'es', 'fr', 'de', 'ru'] as const;
export type MailLanguage = (typeof MAIL_LANGUAGES)[number];

/** The language a browser says its player reads. Anything that is not one of the five is read as English. */
export const mailLanguageSchema = z.enum(MAIL_LANGUAGES).catch('en');

type Words = Pick<EmailCopy, 'subject' | 'heading' | 'body' | 'button' | 'linkHint' | 'footer'>;

/** `{username}` in a body is where the account's name goes. */
const NAME = '{username}';

const RESET: Record<MailLanguage, Words> = {
  en: {
    subject: 'Reset your Wherefall password',
    heading: 'Reset your password',
    body: 'Someone asked to reset the password for your Wherefall account {username}. If that was you, choose a new one below.',
    button: 'Reset password',
    linkHint: 'Or paste this link into your browser:',
    footer: "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email and your password stays the same.",
  },
  es: {
    subject: 'Restablece tu contraseña de Wherefall',
    heading: 'Restablece tu contraseña',
    body: 'Alguien ha pedido restablecer la contraseña de tu cuenta de Wherefall {username}. Si has sido tú, elige una nueva aquí abajo.',
    button: 'Restablecer contraseña',
    linkHint: 'O pega este enlace en tu navegador:',
    footer: 'Este enlace funciona una sola vez y caduca en 1 hora. Si no lo has pedido, ignora este correo y tu contraseña seguirá siendo la misma.',
  },
  fr: {
    subject: 'Réinitialisez votre mot de passe Wherefall',
    heading: 'Réinitialisez votre mot de passe',
    body: 'Quelqu’un a demandé à réinitialiser le mot de passe de votre compte Wherefall {username}. Si c’était vous, choisissez-en un nouveau ci-dessous.',
    button: 'Réinitialiser le mot de passe',
    linkHint: 'Ou collez ce lien dans votre navigateur :',
    footer: 'Ce lien ne fonctionne qu’une fois et expire dans 1 heure. Si vous ne l’avez pas demandé, ignorez cet e-mail et votre mot de passe restera le même.',
  },
  de: {
    subject: 'Setze dein Wherefall-Passwort zurück',
    heading: 'Setze dein Passwort zurück',
    body: 'Jemand möchte das Passwort für dein Wherefall-Konto {username} zurücksetzen. Wenn du das warst, wähle unten ein neues.',
    button: 'Passwort zurücksetzen',
    linkHint: 'Oder füge diesen Link in deinen Browser ein:',
    footer: 'Dieser Link funktioniert einmal und läuft nach 1 Stunde ab. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail, und dein Passwort bleibt, wie es ist.',
  },
  ru: {
    subject: 'Сброс пароля Wherefall',
    heading: 'Сбрось пароль',
    body: 'Кто-то запросил сброс пароля для твоего аккаунта Wherefall {username}. Если это был ты, задай новый пароль ниже.',
    button: 'Сбросить пароль',
    linkHint: 'Или вставь эту ссылку в адресную строку браузера:',
    footer: 'Ссылка действует один раз и перестаёт работать через 1 час. Если ты ничего не запрашивал, не обращай внимания на это письмо: пароль останется прежним.',
  },
};

/** The password-reset email for one account, in one language: who it is for and the link that resets it. */
export function resetEmail(lang: MailLanguage, username: string, url: string): EmailCopy {
  const words = RESET[lang];
  return { ...words, app: APP, lang, url, body: words.body.replace(NAME, () => username) };
}
