import { useState, useSyncExternalStore } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AirStrings } from '@airstrings/react-native';
import { DEMO } from './demo.config.generated';
import { LOCALES, PLURAL_COUNTS } from './demo.config';

let logSnapshot: readonly string[] = [];
const logSubscribers = new Set<() => void>();

function pushLog(line: string) {
  logSnapshot = [...logSnapshot, line].slice(-10);
  logSubscribers.forEach(notify => notify());
}

function subscribeLog(notify: () => void) {
  logSubscribers.add(notify);
  return () => {
    logSubscribers.delete(notify);
  };
}

const airstrings = new AirStrings({
  ...DEMO,
  seed: [
    require('./airstrings/bundles/en.json'),
    require('./airstrings/bundles/fr.json'),
    require('./airstrings/bundles/es.json'),
  ],
  logger: (level, message) => pushLog(`[${level}] ${message}`),
});

airstrings.on('strings:error', ({ error }) =>
  pushLog(`[error] ${error.code}: ${error.message}`),
);

function subscribeStrings(notify: () => void) {
  return airstrings.on('strings:updated', notify);
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const strings = useSyncExternalStore(subscribeStrings, () => airstrings.strings);
  const logs = useSyncExternalStore(subscribeLog, () => logSnapshot);
  const [locale, setLocale] = useState(airstrings.locale);

  const t = (key: string) => strings[key] ?? key;

  const selectLocale = (next: string) => {
    setLocale(next);
    airstrings.setLocale(next);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Text style={styles.title}>{t('app.title')}</Text>
      <Text style={styles.greeting}>{t('greeting')}</Text>
      <Text style={styles.welcome}>{t('onboarding.welcome')}</Text>

      <View style={styles.card}>
        {PLURAL_COUNTS.map(count => (
          <Text key={count} style={styles.plural}>
            {count} → {airstrings.format('items.count', { count })}
          </Text>
        ))}
      </View>

      <Text style={styles.status}>
        {airstrings.locale} · rev {airstrings.revision} · ready{' '}
        {airstrings.isReady ? 'yes' : 'no'}
      </Text>

      <View style={styles.row}>
        <Button label="Refresh" onPress={() => airstrings.refresh()} />
        {LOCALES.map(l => (
          <Button
            key={l}
            label={l}
            active={l === locale}
            onPress={() => selectLocale(l)}
          />
        ))}
      </View>

      <View style={styles.logPane}>
        {logs.length === 0 ? (
          <Text style={styles.logEmpty}>No log output yet.</Text>
        ) : (
          logs.map((line, i) => (
            <Text key={`${i}-${line}`} style={styles.logLine}>
              {line}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  active,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  content: {
    paddingHorizontal: 20,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
  },
  greeting: {
    fontSize: 20,
    color: '#c7d2fe',
  },
  welcome: {
    fontSize: 16,
    color: '#94a3b8',
  },
  card: {
    backgroundColor: '#131a2e',
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  plural: {
    fontSize: 16,
    color: '#e2e8f0',
  },
  status: {
    fontSize: 13,
    color: '#7dd3fc',
    fontFamily: mono,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  buttonActive: {
    backgroundColor: '#4f46e5',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextActive: {
    color: '#ffffff',
  },
  logPane: {
    backgroundColor: '#05070f',
    borderRadius: 12,
    padding: 12,
    gap: 2,
    minHeight: 120,
  },
  logEmpty: {
    color: '#475569',
    fontFamily: mono,
    fontSize: 12,
  },
  logLine: {
    color: '#a5b4fc',
    fontFamily: mono,
    fontSize: 12,
  },
});

export default App;
