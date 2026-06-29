import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCredential,
  signOut,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  Auth,
  User,
  // @ts-expect-error – exists in the RN bundle but missing from public TS definitions
  getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export const FIREBASE_SETUP_MSG =
  'Firebase is not configured. Open mobile/.env and paste your Web app keys from Firebase Console → Project settings → Your apps, then run: npx expo start -c';

type FirebaseExtra = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

const extra = Constants.expoConfig?.extra?.firebase as FirebaseExtra | undefined;

function env(key: string, fromExtra?: string): string | undefined {
  const value = process.env[key] ?? fromExtra;
  const trimmed = value?.trim();
  return trimmed || undefined;
}

const firebaseConfig = {
  apiKey: env('EXPO_PUBLIC_FIREBASE_API_KEY', extra?.apiKey),
  authDomain: env('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', extra?.authDomain),
  projectId: env('EXPO_PUBLIC_FIREBASE_PROJECT_ID', extra?.projectId),
  storageBucket: env('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', extra?.storageBucket),
  messagingSenderId: env('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', extra?.messagingSenderId),
  appId: env('EXPO_PUBLIC_FIREBASE_APP_ID', extra?.appId),
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey);
}

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

function ensureAuth(): Auth {
  if (!isFirebaseConfigured()) {
    throw new Error(FIREBASE_SETUP_MSG);
  }
  if (authInstance) return authInstance;

  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    authInstance = getAuth(app);
  }
  return authInstance;
}

/** Safe for navigation — returns null when Firebase env vars are missing. */
export function getAuthIfConfigured(): Auth | null {
  if (!isFirebaseConfigured()) return null;
  return ensureAuth();
}

export function subscribeAuthState(
  listener: (user: User | null) => void
): () => void {
  const auth = getAuthIfConfigured();
  if (!auth) {
    listener(null);
    return () => {};
  }
  return onAuthStateChanged(auth, listener);
}

export async function signUpWithEmailPassword(email: string, password: string): Promise<string> {
  const cred = await createUserWithEmailAndPassword(ensureAuth(), email, password);
  return cred.user.uid;
}

export async function signInWithEmailPassword(email: string, password: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(ensureAuth(), email, password);
  return cred.user.uid;
}

export async function signInWithGoogleIdToken(idToken: string, accessToken?: string): Promise<string> {
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const result = await signInWithCredential(ensureAuth(), credential);
  return result.user.uid;
}

export async function signInWithAppleIdentityToken(
  identityToken: string,
  rawNonce: string
): Promise<string> {
  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken: identityToken, rawNonce });
  const result = await signInWithCredential(ensureAuth(), credential);
  return result.user.uid;
}

export async function signOutCurrentUser(): Promise<void> {
  const auth = getAuthIfConfigured();
  if (auth) await signOut(auth);
}
