import { Redirect } from 'expo-router';

// New sharing connections are paused. Old links must not reopen code entry.
export default function InviteScreen() {
  return <Redirect href="/about" />;
}
