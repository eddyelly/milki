import { redirect } from 'next/navigation';

/** The portal starts at the dashboard; the auth guard sends signed-out visitors to /login. */
export default function Home() {
  redirect('/dashboard');
}
