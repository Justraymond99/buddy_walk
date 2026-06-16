import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState, AppStateStatus } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { isFirebaseConfigured, subscribeAuthState } from '../api/firebase';
import { clearLocalAppSession } from '../utils/restartAppSession';
import { primeAnalyticsConsent } from '../utils/analyticsConsent';
import { flush, initTelemetry, trackScreen } from '../api/telemetry';
import { AuthSessionContext } from './authSession';
import { RootStackParamList } from '../types';

import WelcomeScreen from '../screens/WelcomeScreen';
import AuthScreen from '../screens/AuthScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import WaiverScreen from '../screens/WaiverScreen';
import NameScreen from '../screens/NameScreen';
import MainScreen from '../screens/MainScreen';
import CompanionScreen from '../screens/CompanionScreen';
import SavedPlacesScreen from '../screens/SavedPlacesScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const BYPASS_AUTH = Constants.expoConfig?.extra?.bypassAuth === true;

export default function Navigation() {
  const [checking, setChecking] = useState(!BYPASS_AUTH);
  const [skipOnboarding, setSkipOnboarding] = useState(false);
  const [isAuthed, setIsAuthed] = useState(BYPASS_AUTH);
  const [navKey, setNavKey] = useState(0);

  const signOut = useCallback(async () => {
    await clearLocalAppSession();
    setSkipOnboarding(false);
    setIsAuthed(BYPASS_AUTH);
    setNavKey((k) => k + 1);
  }, []);

  const authSession = useMemo(() => ({ signOut }), [signOut]);

  const lastTrackedRoute = useRef<string | undefined>(undefined);

  // Start anonymous usage tracking once, and flush buffered events when the app
  // goes to the background so we don't lose a tester's session.
  useEffect(() => {
    void primeAnalyticsConsent();
    const disposeTelemetry = initTelemetry();
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') void flush();
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => {
      sub.remove();
      disposeTelemetry();
    };
  }, []);

  const handleRouteChange = useCallback(() => {
    const current = navigationRef.getCurrentRoute()?.name;
    if (current && current !== lastTrackedRoute.current) {
      lastTrackedRoute.current = current;
      trackScreen(current);
    }
  }, []);

  useEffect(() => {
    if (BYPASS_AUTH) {
      void (async () => {
        const flag = await AsyncStorage.getItem('onboardingComplete');
        setSkipOnboarding(flag === 'true');
        setChecking(false);
      })();
      return;
    }

    if (!isFirebaseConfigured()) {
      setIsAuthed(false);
      setSkipOnboarding(false);
      setChecking(false);
      return;
    }

    const unsubscribe = subscribeAuthState(async (user) => {
      if (user) {
        setIsAuthed(true);
        const flag = await AsyncStorage.getItem('onboardingComplete');
        setSkipOnboarding(flag === 'true');
      } else {
        setIsAuthed(false);
        setSkipOnboarding(false);
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

  const authedInitialRoute: keyof RootStackParamList =
    skipOnboarding ? 'Main' : 'Permissions';

  return (
    <AuthSessionContext.Provider value={authSession}>
    <NavigationContainer
      key={navKey}
      ref={navigationRef}
      onReady={handleRouteChange}
      onStateChange={handleRouteChange}
    >
      <Stack.Navigator
        initialRouteName={isAuthed ? authedInitialRoute : 'Welcome'}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000' },
          animation: 'slide_from_right',
        }}
      >
        {!isAuthed ? (
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Auth" component={AuthScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Permissions" component={PermissionsScreen} />
            <Stack.Screen name="Waiver" component={WaiverScreen} />
            <Stack.Screen name="Name" component={NameScreen} />
            <Stack.Screen name="Main" component={MainScreen} />
            <Stack.Screen name="Companion" component={CompanionScreen} />
            <Stack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </AuthSessionContext.Provider>
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
