import { AssistantChat } from '@/assistant/react/assistant-chat'
import {
  loadAssistantConversation, sendAssistantConversationToSupport, sendAssistantMessage,
} from '@/lib/assistant-actions'
import { isAssistantEnabled } from '@/lib/assistant/host'

const WELCOME = {
  candidate: 'Posez votre question sur l’utilisation de MyBestConsultant : profil, CV, recherche d’offres, candidatures, entretiens, support…',
  recruiter: 'Posez votre question sur l’utilisation de MyBestConsultant : annonces, candidats, pipeline, entretiens, équipe, abonnement…',
} as const

/**
 * Assistant IA des espaces candidat et recruteur (module src/assistant, branché par src/lib/assistant). Affiché si
 * l'assistant est activé et l'adresse e-mail vérifiée (le bandeau de vérification invite déjà à le faire). Le rôle ne
 * sert qu'au texte d'accueil : les actions revérifient l'utilisateur à chaque appel.
 */
export function MbcAssistant({ role, verified }: { role: keyof typeof WELCOME; verified: boolean }) {
  if (!verified || !isAssistantEnabled()) return null
  return (
    <div className="mbc-assistant">
      <AssistantChat welcome={WELCOME[role]} send={sendAssistantMessage} loadLatest={loadAssistantConversation} handoff={sendAssistantConversationToSupport} />
    </div>
  )
}
