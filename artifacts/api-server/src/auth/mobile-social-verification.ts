import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const googleClient = new OAuth2Client();
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function audiences(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function verifyMobileGoogleToken(idToken: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: audiences([
      process.env.GOOGLE_CLIENT_ID,
      '246210957471-18662dh38h9tmlk7nppdk15ucbha4emk.apps.googleusercontent.com',
      '246210957471-4dmnb95bcduaocr8toiphv3guq9a8htl.apps.googleusercontent.com',
      '957628580421-1gj9mmbq20o9jva6olb28t2un6vb6jqh.apps.googleusercontent.com',
      // Firebase web/server client used by the shipped native apps. Google
      // checks this audience even when the login starts from the iOS SDK.
      '957628580421-ob14qeft7j83apkdjqfn48o3961qk7ti.apps.googleusercontent.com',
      '957628580421-664s6dft9n8kp91futrnpsugd4fcsonn.apps.googleusercontent.com',
    ]),
  });
  return ticket.getPayload();
}

export async function verifyMobileAppleToken(identityToken: string) {
  const { payload } = await jwtVerify(identityToken, appleKeys, {
    issuer: 'https://appleid.apple.com',
    // A web Services ID must not replace the native bundle audience.
    audience: audiences([
      'com.visiongo.megaradio',
      process.env.APPLE_CLIENT_ID,
      process.env.APPLE_SERVICE_ID,
    ]),
  });
  return payload;
}
