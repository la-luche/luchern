import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { createGuest } from '../../lib/guests';
import { useT } from '../../lib/i18n';
import { COLORS } from '../../lib/theme';

export default function NewGuestScreen() {
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(true);
      return;
    }
    setCreating(true);
    try {
      const guest = await createGuest(trimmedName, notes);
      router.replace({ pathname: '/guests/[id]', params: { id: guest.id } });
    } catch {
      setCreating(false);
      Alert.alert(t.guests.createFailed, t.guests.createFailedBody);
    }
  };

  return (
    <Screen>
      <Header title={t.guests.newTitle} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 pb-10 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-[15px] font-semibold text-ink">{t.guests.name}</Text>
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (value.trim()) setNameError(false);
            }}
            placeholder={t.guests.namePlaceholder}
            placeholderTextColor={COLORS.inkMuted}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            maxLength={120}
            className={`mt-2 min-h-14 rounded-2xl border bg-white px-4 text-[17px] text-ink ${
              nameError ? 'border-red-500' : 'border-ink-faint'
            }`}
          />
          {nameError && (
            <Text className="mt-2 text-[14px] text-red-700">{t.guests.nameRequired}</Text>
          )}

          <Text className="mt-6 text-[15px] font-semibold text-ink">{t.guests.notes}</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t.guests.notesPlaceholder}
            placeholderTextColor={COLORS.inkMuted}
            multiline
            textAlignVertical="top"
            maxLength={2000}
            className="mt-2 min-h-32 rounded-2xl border border-ink-faint bg-white px-4 py-4 text-[16px] leading-6 text-ink"
          />

          <View className="mt-8">
            <Button
              title={creating ? t.guests.creating : t.guests.create}
              onPress={() => void submit()}
              disabled={creating || !name.trim()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
