import { getState } from '@/lib/data';
import Arena from './arena';

// Always read fresh arena state from the database on each request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const initialState = await getState();
  return <Arena initialState={initialState} />;
}
