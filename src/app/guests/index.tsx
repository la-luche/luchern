import { Redirect } from 'expo-router';

/** Keep older links working without restoring the retired guest menu. */
export default function LegacyGuestsRedirect() {
  return <Redirect href={{ pathname: '/people', params: { mode: 'history' } }} />;
}
