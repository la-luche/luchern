import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useGuests } from '../../lib/guestStorage';
import type { Guest } from '../../lib/guests';
import { useT } from '../../lib/i18n';
import { useRecordings } from '../../lib/storage';
import { COLORS } from '../../lib/theme';

interface GuestListItem extends Guest {
  effectiveTestCount: number;
  effectiveActivityAt: number;
}

export default function GuestsScreen() {
  const router = useRouter();
  const t = useT();
  const { recordings } = useRecordings({ includeGuests: true });
  const { guests, loading, refresh } = useGuests();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      await refresh();
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const items = useMemo<GuestListItem[]>(() => {
    const localCount = new Map<string, number>();
    const localLatest = new Map<string, number>();
    for (const recording of recordings) {
      if (!recording.guestId) continue;
      localCount.set(recording.guestId, (localCount.get(recording.guestId) ?? 0) + 1);
      localLatest.set(
        recording.guestId,
        Math.max(localLatest.get(recording.guestId) ?? 0, recording.createdAt),
      );
    }
    return guests
      .map((guest) => ({
        ...guest,
        effectiveTestCount: Math.max(guest.testCount, localCount.get(guest.id) ?? 0),
        effectiveActivityAt: Math.max(
          guest.lastRecordedAt ?? 0,
          localLatest.get(guest.id) ?? 0,
          guest.createdAt,
        ),
      }))
      .sort((a, b) => b.effectiveActivityAt - a.effectiveActivityAt);
  }, [guests, recordings]);

  return (
    <Screen>
      <Header title={t.guests.title} />
      <FlatList
        data={loading ? [] : items}
        keyExtractor={(guest) => guest.id}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        contentContainerClassName="px-6 pb-10 pt-3"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        ListHeaderComponent={
          <View className="mb-6">
            <Button title={t.guests.addGuest} onPress={() => router.push('/guests/new')} />
          </View>
        }
        ListEmptyComponent={loading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={COLORS.ink} />
          </View>
        ) : failed && items.length === 0 ? (
          <View className="items-center py-14">
            <Text className="text-center text-[16px] font-semibold text-ink">
              {t.guests.loadFailed}
            </Text>
            <Text className="mt-2 text-center text-[14px] leading-5 text-ink-muted">
              {t.guests.loadFailedBody}
            </Text>
            <View className="mt-5 w-full">
              <Button title={t.guests.tryAgain} variant="secondary" onPress={() => void load()} />
            </View>
          </View>
        ) : items.length === 0 ? (
          <View className="items-center px-4 py-16">
            <Ionicons name="people-outline" size={42} color={COLORS.inkMuted} />
            <Text className="mt-4 text-center text-[18px] font-semibold text-ink">
              {t.guests.emptyTitle}
            </Text>
            <Text className="mt-2 text-center text-[14px] leading-5 text-ink-muted">
              {t.guests.emptyBody}
            </Text>
          </View>
        ) : null}
        renderItem={({ item: guest, index }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/guests/[id]', params: { id: guest.id } })
            }
            accessibilityRole="button"
            accessibilityLabel={t.guests.openGuestA11y(
              guest.name,
              guest.effectiveTestCount,
            )}
            className={`min-h-[72px] flex-row items-center border-x border-t border-ink-faint bg-white px-4 py-3 active:bg-ink-faint ${
              index === 0 ? 'rounded-t-2xl' : ''
            } ${index === items.length - 1 ? 'rounded-b-2xl border-b' : ''}`}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-ink-faint">
              <Ionicons name="person-outline" size={22} color={COLORS.ink} />
            </View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} className="text-[17px] font-semibold text-ink">
                {guest.name}
              </Text>
              <Text className="mt-0.5 text-[14px] text-ink-muted">
                {t.guests.testCount(guest.effectiveTestCount)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.inkMuted} />
          </Pressable>
        )}
      />
    </Screen>
  );
}
