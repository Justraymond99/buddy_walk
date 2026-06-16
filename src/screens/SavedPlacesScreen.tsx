import { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';
import {
  SavedPlace,
  deletePlace,
  listSavedPlaces,
  savePlace,
} from '../utils/savedPlaces';
import { track, Events } from '../api/telemetry';

type Props = NativeStackScreenProps<RootStackParamList, 'SavedPlaces'>;

const SUGGESTED_ALIASES = ['home', 'work', 'pharmacy', 'doctor', 'gym'];

export default function SavedPlacesScreen({ navigation }: Props) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [alias, setAlias] = useState('');
  const [address, setAddress] = useState('');
  const [resolvingLocation, setResolvingLocation] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSavedPlaces();
      setPlaces(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleUseCurrentLocation() {
    setResolvingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location to autofill addresses.');
        return;
      }
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const results = await Location.reverseGeocodeAsync({
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
      });
      const top = results[0];
      if (top) {
        const composed = [
          top.streetNumber,
          top.street,
          top.city,
          top.region,
          top.postalCode,
          top.country,
        ]
          .filter(Boolean)
          .join(', ');
        setAddress(composed || `${fix.coords.latitude}, ${fix.coords.longitude}`);
      } else {
        setAddress(`${fix.coords.latitude}, ${fix.coords.longitude}`);
      }
    } catch (e) {
      console.warn('reverse geocode failed:', e);
      Alert.alert('Could not get location', 'Please type the address manually.');
    } finally {
      setResolvingLocation(false);
    }
  }

  async function handleSave() {
    const aliasTrim = alias.trim();
    const addressTrim = address.trim();
    if (!aliasTrim || !addressTrim) {
      Alert.alert('Missing info', 'Please enter both a name and an address.');
      return;
    }
    setBusy(true);
    try {
      const saved = await savePlace({ alias: aliasTrim, address: addressTrim });
      setAlias('');
      setAddress('');
      await reload();
      Speech.speak(`Saved ${saved.alias}.`, { language: 'en-US' });
      AccessibilityInfo.announceForAccessibility(`Saved ${saved.alias}.`);
      void track(Events.SavedPlaceCreated, { aliasLength: saved.alias.length });
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(place: SavedPlace) {
    Alert.alert(
      'Remove saved place?',
      `"${place.alias}" will no longer auto-resolve in your questions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deletePlace(place.id);
            await reload();
            Speech.speak(`Removed ${place.alias}.`, { language: 'en-US' });
            void track(Events.SavedPlaceDeleted, { aliasLength: place.alias.length });
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor="#fff"
          size={28}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to main screen"
        />
        <Text style={styles.headerTitle} accessibilityRole="header">
          Saved Places
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Bookmark places you visit often. Buddy Walk will recognize names like
          "home" or "work" inside your questions and use the saved address.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add a place</Text>

          <Text style={styles.label}>Name</Text>
          <TextInput
            value={alias}
            onChangeText={setAlias}
            placeholder="e.g. home"
            placeholderTextColor="#888"
            style={styles.input}
            autoCapitalize="none"
            maxLength={40}
            accessibilityLabel="Place nickname"
          />
          <View style={styles.suggestionRow}>
            {SUGGESTED_ALIASES.map((s) => (
              <Pressable
                key={s}
                onPress={() => setAlias(s)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                accessibilityLabel={`Use suggestion ${s}`}
                accessibilityRole="button"
              >
                <Text style={styles.chipLabel}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Address</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main Street, Brooklyn, NY"
            placeholderTextColor="#888"
            style={[styles.input, styles.multiline]}
            multiline
            accessibilityLabel="Street address"
          />
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={resolvingLocation}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
            accessibilityLabel="Fill address from my current location"
            accessibilityRole="button"
          >
            {resolvingLocation ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.secondaryButtonLabel}>USE MY CURRENT LOCATION</Text>
            )}
          </Pressable>

          <Pressable
            onPress={handleSave}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              busy && styles.primaryButtonDisabled,
            ]}
            accessibilityLabel="Save this place"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryButtonLabel}>SAVE PLACE</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Your places {places.length > 0 ? `(${places.length})` : ''}
          </Text>

          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : places.length === 0 ? (
            <Text style={styles.empty}>
              No saved places yet. Add one above so you can ask things like "How do I get
              home?".
            </Text>
          ) : (
            places.map((p) => (
              <View key={p.id} style={styles.placeRow} accessible accessibilityLabel={`${p.alias}, ${p.address}`}>
                <View style={styles.placeText}>
                  <Text style={styles.placeAlias}>{p.alias}</Text>
                  <Text style={styles.placeAddress} numberOfLines={3}>
                    {p.address}
                  </Text>
                </View>
                <IconButton
                  icon="trash-can-outline"
                  iconColor="#ff8a8a"
                  size={24}
                  onPress={() => confirmDelete(p)}
                  accessibilityLabel={`Remove ${p.alias}`}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  scroll: { padding: 20, gap: 16, flexGrow: 1 },
  lead: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2a313c',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  label: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    color: '#000',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2a313c',
    borderRadius: 999,
  },
  chipPressed: { backgroundColor: '#3d4654' },
  chipLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
  },
  secondaryButtonPressed: { opacity: 0.7 },
  secondaryButtonLabel: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  primaryButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonPressed: { backgroundColor: '#e0e0e0' },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonLabel: { color: '#000', fontSize: 17, fontWeight: 'bold', letterSpacing: 1.2 },
  empty: { color: '#aab1bd', fontSize: 15, lineHeight: 22 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0e1116',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2a313c',
  },
  placeText: { flex: 1 },
  placeAlias: { color: '#fff', fontSize: 17, fontWeight: '700' },
  placeAddress: { color: '#aab1bd', fontSize: 14, marginTop: 2 },
});
