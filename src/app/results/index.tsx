import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { Header } from '../../components/Header';
import { RecordingCard } from '../../components/RecordingCard';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { useRecordings } from '../../lib/storage';
import { COLORS } from '../../lib/theme';

/** List of previous recordings as cards, newest first. */
export default function ResultsScreen() {
  const router = useRouter();
  const { recordings, loading } = useRecordings();
  const t = useT();

  return (
    <Screen>
      <Header title={t.resultsList.title} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.ink} />
        </View>
      ) : recordings.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <MaterialCommunityIcons name="video-off-outline" size={52} color={COLORS.inkFaint} />
          <Text className="mt-4 text-center text-[17px] font-semibold text-ink">
            {t.resultsList.emptyTitle}
          </Text>
          <Text className="mt-1 text-center text-[14px] text-ink-muted">
            {t.resultsList.emptyBody}
          </Text>
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(r) => r.id}
          contentContainerClassName="px-6 pb-8 gap-3"
          renderItem={({ item }) => (
            <RecordingCard
              recording={item}
              onPress={() => router.push({ pathname: '/results/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}
