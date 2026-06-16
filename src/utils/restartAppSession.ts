import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOutCurrentUser } from '../api/firebase';

/** Wipe local onboarding flags so the app can run Welcome/Permissions again. */
export async function clearLocalAppSession(): Promise<void> {
  await signOutCurrentUser();
  await AsyncStorage.multiRemove(['onboardingComplete', 'name']);
}
