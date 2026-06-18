import { Platform } from 'react-native';
import * as Location from 'expo-location';

export type LocationPermissionState = 'granted' | 'denied' | 'undetermined';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 12_000,
};

function webGeolocationPrompt(): Promise<LocationPermissionState> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve('denied');
      return;
    }

    const timer = setTimeout(() => resolve('denied'), 15_000);
    navigator.geolocation.getCurrentPosition(
      () => {
        clearTimeout(timer);
        resolve('granted');
      },
      (err) => {
        clearTimeout(timer);
        resolve(err?.code === 1 ? 'denied' : 'denied');
      },
      GEO_OPTIONS
    );
  });
}

/** Read current location permission without prompting. */
export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  if (Platform.OS !== 'web') {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  }

  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') return 'granted';
      if (perm.state === 'denied') return 'denied';
    }
  } catch {
    // Safari does not support permissions.query for geolocation.
  }

  return 'undetermined';
}

/**
 * Request location access. Safari/iOS WebKit lacks navigator.permissions.query,
 * so expo-location throws — we fall back to getCurrentPosition with a timeout.
 */
export async function requestLocationPermission(): Promise<LocationPermissionState> {
  if (Platform.OS !== 'web') {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'denied';
  }

  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') return 'granted';
      if (perm.state === 'denied') return 'denied';
    }
  } catch {
    // Fall through — Safari needs getCurrentPosition to show the prompt.
  }

  return webGeolocationPrompt();
}
