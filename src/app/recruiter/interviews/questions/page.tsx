import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getGenericQuestions } from '../generic-questions-actions'
import { GenericQuestionsClient } from './questions-client'

export default async function GenericQuestionsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')

  const questions = await getGenericQuestions()

  return <GenericQuestionsClient initialQuestions={questions} />
}
