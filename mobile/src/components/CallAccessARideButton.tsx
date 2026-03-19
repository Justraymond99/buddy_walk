import React from 'react';
import { Pressable, Text, StyleSheet, Linking } from 'react-native';
import * as Speech from 'expo-speech';

const AAR_NUMBER = '8773372017';

export default function CallAccessARideButton() {
  function handlePress() {
    Speech.speak('Calling Access-A-Ride.');
    Linking.openURL(`tel:${AAR_NUMBER}`);
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      accessibilityLabel="Call Access-A-Ride"
      accessibilityRole="button"
      accessibilityHint="Calls Access-A-Ride at 877-337-2017"
    >
      <Text style={styles.icon}>📞</Text>
      <Text style={styles.label}>AAR</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 80,
    height: 80,
    backgroundColor: '#fff',
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 1000,
  },
  buttonPressed: {
    backgroundColor: '#f2f2f2',
  },
  icon: {
    fontSize: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
});
