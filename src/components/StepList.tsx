import { Text, View } from 'react-native';

/** Instruction steps separated by spacing. */
export function StepList({ steps }: { steps: string[] }) {
  return (
    <View className="gap-3">
      {steps.map((step, i) => (
        <Text key={i} className="text-[17px] leading-6 text-ink/80">{step}</Text>
      ))}
    </View>
  );
}
