import { Alert, Linking } from 'react-native';
import { Audio } from 'expo-av';

/** Request mic access before expo-av Recording (needed when Permissions screen was skipped). */
export async function ensureMicrophonePermission(): Promise<boolean> {
  const current = await Audio.getPermissionsAsync();
  if (current.granted) return true;

  if (current.canAskAgain) {
    const requested = await Audio.requestPermissionsAsync();
    if (requested.granted) return true;
  }

  Alert.alert(
    'Microphone permission required',
    'Buddy Walk needs microphone access for Tap to Ask. Enable it in Settings.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]
  );
  return false;
}
