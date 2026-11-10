import { Redirect } from 'expo-router';

// Keep old links safe while code creation is paused; existing sharing stays live.
export default function ShareCodeScreen() {
  return <Redirect href="/about" />;
}
