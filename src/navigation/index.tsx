import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../api/firebase';
import { RootStackParamList } from '../types';

import WelcomeScreen from '../screens/WelcomeScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import WaiverScreen from '../screens/WaiverScreen';
import NameScreen from '../screens/NameScreen';
import MainScreen from '../screens/MainScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const [checking, setChecking] = useState(true);
  const [skipOnboarding, setSkipOnboarding] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const flag = await AsyncStorage.getItem('onboardingComplete');
        setSkipOnboarding(flag === 'true');
      }
      setChecking(false);
    });
    return unsubscribe;
  }, []);

  if (checking) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={skipOnboarding ? 'Main' : 'Welcome'}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} />
        <Stack.Screen name="Waiver" component={WaiverScreen} />
        <Stack.Screen name="Name" component={NameScreen} />
        <Stack.Screen name="Main" component={MainScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
