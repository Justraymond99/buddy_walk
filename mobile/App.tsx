import React from 'react';
import { PaperProvider, MD3DarkTheme } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import Navigation from './src/navigation';

const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    background: '#000000',
    surface: '#1a1a1a',
    primary: '#ffffff',
    onPrimary: '#000000',
  },
};

export default function App() {
  return (
    <PaperProvider theme={theme}>
      <StatusBar style="light" />
      <Navigation />
    </PaperProvider>
  );
}
