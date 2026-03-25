import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import { Audio } from 'expo-av';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Permissions'>;

export default function PermissionsScreen({ navigation }: Props) {
  const [locationGranted, setLocationGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);

  const allGranted = locationGranted && cameraGranted && micGranted;

  async function requestLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationGranted(true);
    } else {
      Alert.alert('Location Access Denied', 'Location is required for navigation features.');
    }
  }

  async function requestCamera() {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status === 'granted') {
      setCameraGranted(true);
    } else {
      Alert.alert('Camera Access Denied', 'Camera is required to capture photos and videos.');
    }
  }

  async function requestMic() {
    const { status } = await Audio.requestPermissionsAsync();
    if (status === 'granted') {
      setMicGranted(true);
    } else {
      Alert.alert('Microphone Access Denied', 'Microphone is required to ask questions by voice.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title} variant="headlineMedium" accessibilityRole="header">
        USER AGREEMENT
      </Text>

      <View style={styles.waiverBox}>
        <Text style={styles.waiverText}>
          This app is designed to assist blind and visually impaired users in navigation. Due
          to AI limitations and GPS accuracy, the app may not always provide correct information.
          Users should not rely solely on this app.{' '}
        </Text>
        <Text
          style={styles.waiverLink}
          onPress={() => navigation.navigate('Waiver')}
          accessibilityRole="link"
          accessibilityLabel="Read full waiver"
        >
          Read Full Waiver
        </Text>
      </View>

      <Text style={styles.instructions}>
        Please enable location, camera, and microphone to continue.
      </Text>

      <View style={styles.buttons}>
        <Button
          mode="contained"
          onPress={requestLocation}
          style={[styles.button, locationGranted && styles.buttonGranted]}
          contentStyle={styles.buttonContent}
          labelStyle={[styles.buttonLabel, locationGranted && styles.buttonLabelGranted]}
          accessibilityLabel={locationGranted ? 'Location enabled' : 'Enable location access'}
          icon={locationGranted ? 'check' : 'map-marker'}
        >
          {locationGranted ? 'Location Enabled' : 'Enable Location'}
        </Button>

        <Button
          mode="contained"
          onPress={requestCamera}
          style={[styles.button, cameraGranted && styles.buttonGranted]}
          contentStyle={styles.buttonContent}
          labelStyle={[styles.buttonLabel, cameraGranted && styles.buttonLabelGranted]}
          accessibilityLabel={cameraGranted ? 'Camera enabled' : 'Enable camera access'}
          icon={cameraGranted ? 'check' : 'camera'}
        >
          {cameraGranted ? 'Camera Enabled' : 'Enable Camera'}
        </Button>

        <Button
          mode="contained"
          onPress={requestMic}
          style={[styles.button, micGranted && styles.buttonGranted]}
          contentStyle={styles.buttonContent}
          labelStyle={[styles.buttonLabel, micGranted && styles.buttonLabelGranted]}
          accessibilityLabel={micGranted ? 'Microphone enabled' : 'Enable microphone access'}
          icon={micGranted ? 'check' : 'microphone'}
        >
          {micGranted ? 'Microphone Enabled' : 'Enable Microphone'}
        </Button>
      </View>

      {allGranted && (
        <Button
          mode="contained"
          onPress={() => navigation.navigate('Main')}
          style={styles.continueButton}
          contentStyle={styles.continueButtonContent}
          labelStyle={styles.continueButtonLabel}
          accessibilityLabel="Continue to Buddy Walk"
          icon="arrow-right"
        >
          Continue
        </Button>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  title: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 16,
  },
  waiverBox: {
    borderWidth: 1,
    borderColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  waiverText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 22,
  },
  waiverLink: {
    color: '#fff',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
    marginTop: 8,
  },
  instructions: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 24,
  },
  buttons: {
    gap: 12,
  },
  button: {
    borderRadius: 40,
    backgroundColor: '#fff',
  },
  buttonGranted: {
    backgroundColor: '#2e7d32',
  },
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  buttonLabelGranted: {
    color: '#fff',
  },
  continueButton: {
    borderRadius: 40,
    backgroundColor: '#fff',
    marginTop: 'auto',
    marginBottom: 8,
  },
  continueButtonContent: {
    paddingVertical: 16,
    flexDirection: 'row-reverse',
  },
  continueButtonLabel: {
    color: '#000',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
});
