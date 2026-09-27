import { getInterviewPrefillData, type InterviewPrefill } from '../actions'
import { NewInterviewClient } from './new-interview-client'

const EMPTY_FORM: InterviewPrefill = {
  candidateName: '', candidateEmail: '', jobTitle: '', jobDescription: '', jobSkills: '', cvSummary: '',
}

export default async function NewInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ appId?: string; jobId?: string }>
}) {
  const { appId, jobId } = await searchParams

  if (!appId) {
    return <NewInterviewClient initialForm={EMPTY_FORM} prefilled={false} appId="" jobId="" />
  }

  const result = await getInterviewPrefillData(appId)
  const initialForm = 'error' in result ? EMPTY_FORM : result

  return <NewInterviewClient initialForm={initialForm} prefilled={!('error' in result)} appId={appId} jobId={jobId ?? ''} />
}
