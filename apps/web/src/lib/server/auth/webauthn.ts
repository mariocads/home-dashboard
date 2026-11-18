import type { Db } from '@hd/db';
import { schema } from '@hd/db';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config.ts';
import { findPasskey, listPasskeys, saveChallenge, takeChallenge } from './store.ts';

const { passkeys } = schema;

export class AuthError extends Error {}

export async function startRegistration(db: Db, config: AppConfig, user: { id: string; username: string }) {
  const existing = await listPasskeys(db, user.id);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: user.username,
    userDisplayName: 'Home Dashboard Admin',
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await saveChallenge(db, options.challenge, 'register', user.id);
  return { options, challengeId };
}

export async function finishRegistration(
  db: Db,
  config: AppConfig,
  challengeId: string,
  response: RegistrationResponseJSON,
  name: string,
) {
  const challenge = await takeChallenge(db, challengeId, 'register');
  if (!challenge?.userId) throw new AuthError('Challenge ungültig oder abgelaufen.');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    requireUserVerification: true,
  });
  if (!verification.verified) throw new AuthError('Passkey konnte nicht verifiziert werden.');

  const info = verification.registrationInfo;
  await db.insert(passkeys).values({
    id: info.credential.id,
    userId: challenge.userId,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: name.trim().slice(0, 60) || 'Passkey',
  });
  return { userId: challenge.userId };
}

export async function startLogin(db: Db, config: AppConfig) {
  // Leere allowCredentials → discoverable credentials, kein Benutzername nötig.
  const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required' });
  const challengeId = await saveChallenge(db, options.challenge, 'login', null);
  return { options, challengeId };
}

export async function finishLogin(
  db: Db,
  config: AppConfig,
  challengeId: string,
  response: AuthenticationResponseJSON,
) {
  const challenge = await takeChallenge(db, challengeId, 'login');
  if (!challenge) throw new AuthError('Challenge ungültig oder abgelaufen.');
  const passkey = await findPasskey(db, response.id);
  if (!passkey) throw new AuthError('Unbekannter Passkey.');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.id,
      publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });
  if (!verification.verified) throw new AuthError('Anmeldung fehlgeschlagen.');

  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, passkey.id));
  return { userId: passkey.userId };
}
