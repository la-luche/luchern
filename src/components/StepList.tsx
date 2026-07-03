import { Text, View } from 'react-native';

/** Bulleted instruction steps, matching the Swift InstructionScreen bullets. */
export function StepList({ steps }: { steps: string[] }) {
  return (
    <View className="gap-3">
      {steps.map((step, i) => (
        <View key={i} className="flex-row items-start">
          <Text className="w-4 text-[18px] font-bold text-ink/70">•</Text>
          <Text className="flex-1 text-[17px] leading-6 text-ink/80">{step}</Text>
        </View>
      ))}
    </View>
  );
}
