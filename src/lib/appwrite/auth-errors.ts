import { AppwriteException } from 'node-appwrite'

// Traduit les erreurs d'authentification Appwrite (anglais, souvent génériques) en messages français clairs.
// Aucun message brut du serveur n'est jamais montré à l'utilisateur.

export type AuthContext = 'login' | 'register' | 'forgot' | 'reset'

const EMAIL_EXISTS = 'Un compte existe déjà avec cette adresse email. Connectez-vous, ou utilisez « Mot de passe oublié » si vous ne vous en souvenez plus.'

export function translateAuthError(err: unknown, context: AuthContext): string {
  const type = err instanceof AppwriteException ? err.type : ''
  const code = err instanceof AppwriteException ? err.code : 0
  const raw = err instanceof Error ? err.message.toLowerCase() : ''

  // Adresse déjà utilisée (compte Appwrite, cible d'email ou fiche profil en doublon)
  if (type === 'user_already_exists' || type === 'user_email_already_exists' || type === 'document_already_exists' || (code === 409 && context === 'register')
    || raw.includes('already exists')) {
    return context === 'register' ? EMAIL_EXISTS : 'Cette opération est déjà en cours ou déjà effectuée.'
  }
  if (type === 'user_invalid_credentials' || raw.includes('invalid credentials')) return 'Email ou mot de passe incorrect.'
  if (type === 'user_blocked') return 'Ce compte est désactivé. Contactez le support pour le réactiver.'
  if (type === 'general_rate_limit_exceeded' || code === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.'
  if (type.startsWith('password_') || raw.includes('password')) {
    return context === 'login' ? 'Email ou mot de passe incorrect.' : 'Ce mot de passe n’est pas accepté : choisissez-en un plus long (8 caractères minimum) et moins courant.'
  }
  if (context === 'reset' && (raw.includes('expired') || raw.includes('invalid') || type === 'user_invalid_token')) return 'Ce lien a expiré ou n’est plus valide. Recommencez la procédure « Mot de passe oublié ».'
  // Erreur 400 générique d'Appwrite (« There was an error processing your request… ») : le plus souvent une adresse email invalide ou déjà prise.
  if (type === 'general_bad_request' || type === 'general_argument_invalid' || code === 400) {
    return context === 'register'
      ? 'Impossible de créer le compte avec ces informations. Vérifiez votre adresse email (ou connectez-vous si vous avez déjà un compte) et choisissez un mot de passe d’au moins 8 caractères.'
      : 'Les informations saisies ne sont pas valides. Vérifiez-les et réessayez.'
  }
  if (code >= 500 || raw.includes('fetch failed') || raw.includes('econn')) return 'Le service est momentanément indisponible. Réessayez dans un instant.'
  return context === 'register' ? 'L’inscription a échoué. Réessayez dans un instant ; si le problème continue, contactez le support.'
    : context === 'login' ? 'La connexion a échoué. Réessayez dans un instant.'
    : 'Une erreur est survenue. Réessayez dans un instant.'
}

export { EMAIL_EXISTS }
