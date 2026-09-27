import { getAllRecordings } from './actions'
import { RecordingsClient } from './recordings-client'

export default async function AdminRecordingsPage() {
  const { rows } = await getAllRecordings()
  return <RecordingsClient rows={rows} />
}
