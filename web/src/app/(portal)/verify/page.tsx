import { VerifyView } from './verify-view';

/** Client view; renders after the session is restored, so navigations may wait (instant = false). */
export const instant = false;

export default function Page() {
  return <VerifyView />;
}
