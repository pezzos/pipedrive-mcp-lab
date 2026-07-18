export const remoteOAuthErrorCodes = [
  "admin_confirmation_required",
  "admin_csrf_invalid",
  "admin_method_not_allowed",
  "admin_origin_invalid",
  "admin_required",
  "oauth_authorization_denied",
  "oauth_code_invalid",
  "oauth_encryption_failed",
  "oauth_encryption_key_invalid",
  "oauth_material_invalid",
  "oauth_redirect_invalid",
  "oauth_state_invalid",
  "pipedrive_connect_failed",
  "pipedrive_credential_unavailable",
  "pipedrive_not_connected",
  "pipedrive_oauth_failed",
  "pipedrive_oauth_invalid_response",
  "pipedrive_oauth_invocation_failed",
  "pipedrive_oauth_unavailable",
  "pipedrive_reconnect_required",
  "invalid_pipedrive_api_domain",
  "tenant_internal_error",
  "tenant_request_invalid",
  "tenant_storage_unavailable",
] as const;

export type RemoteOAuthErrorCode = (typeof remoteOAuthErrorCodes)[number];

const errorCodeSet = new Set<string>(remoteOAuthErrorCodes);

const internalErrorStatuses: Record<RemoteOAuthErrorCode, number> = {
  admin_confirmation_required: 400,
  admin_csrf_invalid: 403,
  admin_method_not_allowed: 405,
  admin_origin_invalid: 403,
  admin_required: 403,
  oauth_authorization_denied: 400,
  oauth_code_invalid: 400,
  oauth_encryption_failed: 503,
  oauth_encryption_key_invalid: 503,
  oauth_material_invalid: 409,
  oauth_redirect_invalid: 400,
  oauth_state_invalid: 400,
  pipedrive_connect_failed: 503,
  pipedrive_credential_unavailable: 503,
  pipedrive_not_connected: 404,
  pipedrive_oauth_failed: 502,
  pipedrive_oauth_invalid_response: 502,
  pipedrive_oauth_invocation_failed: 503,
  pipedrive_oauth_unavailable: 502,
  pipedrive_reconnect_required: 409,
  invalid_pipedrive_api_domain: 502,
  tenant_internal_error: 503,
  tenant_request_invalid: 400,
  tenant_storage_unavailable: 503,
};

const dependencyErrorStatuses: Record<RemoteOAuthErrorCode, number> = {
  ...internalErrorStatuses,
  pipedrive_not_connected: 503,
};

export function normalizeRemoteOAuthErrorCode(
  value: unknown,
  fallback: RemoteOAuthErrorCode = "tenant_internal_error",
): RemoteOAuthErrorCode {
  return typeof value === "string" && errorCodeSet.has(value)
    ? value as RemoteOAuthErrorCode
    : fallback;
}

export function hasRemoteOAuthErrorCode(
  error: unknown,
  code: RemoteOAuthErrorCode,
): boolean {
  return error instanceof Error && error.message === code;
}

export function remoteOAuthErrorStatus(code: RemoteOAuthErrorCode): number {
  return internalErrorStatuses[code];
}

export function remoteOAuthDependencyStatus(code: RemoteOAuthErrorCode): number {
  return dependencyErrorStatuses[code];
}

export function remoteOAuthErrorMessage(code: RemoteOAuthErrorCode): string {
  if (code === "admin_required") {
    return "Cette page est réservée à l’administrateur Pipedrive configuré.";
  }
  if (code === "admin_origin_invalid") {
    return "L’origine de la requête d’administration est invalide.";
  }
  if (code === "admin_confirmation_required") {
    return "Confirmez explicitement la suppression locale des jetons avant de continuer.";
  }
  if (code === "admin_csrf_invalid") {
    return "La confirmation d’administration a expiré ou a déjà été utilisée. Rechargez la page.";
  }
  if (code === "oauth_authorization_denied") {
    return "L’autorisation Pipedrive a été refusée. Recommencez depuis la page d’administration si vous souhaitez connecter le serveur.";
  }
  if (code === "oauth_state_invalid" || code === "oauth_code_invalid") {
    return "La session OAuth a expiré ou a déjà été utilisée. Recommencez depuis la page d’administration.";
  }
  if (code === "oauth_redirect_invalid") {
    return "L’adresse de callback OAuth est invalide. Vérifiez la configuration du domaine Worker.";
  }
  if (code === "pipedrive_reconnect_required" || code === "oauth_material_invalid") {
    return "La connexion Pipedrive doit être renouvelée depuis la page d’administration.";
  }
  if (code === "oauth_encryption_key_invalid" || code === "oauth_encryption_failed") {
    return "La configuration de chiffrement OAuth est invalide. Vérifiez la clé du Worker avant de recommencer.";
  }
  if (code === "pipedrive_oauth_invocation_failed") {
    return "Le runtime Worker n’a pas pu initialiser la requête OAuth. Vérifiez le déploiement avant de recommencer.";
  }
  if (code === "tenant_storage_unavailable") {
    return "Le stockage sécurisé du Worker est momentanément indisponible. Réessayez plus tard.";
  }
  if (
    code === "pipedrive_oauth_failed" ||
    code === "pipedrive_oauth_invalid_response" ||
    code === "pipedrive_oauth_unavailable" ||
    code === "invalid_pipedrive_api_domain"
  ) {
    return "L’échange OAuth avec Pipedrive a échoué. Vérifiez l’application Pipedrive et réessayez.";
  }
  if (code === "pipedrive_not_connected") {
    return "Pipedrive n’est pas encore connecté.";
  }
  return "Le service OAuth est momentanément indisponible. Corrélez cette erreur avec l’identifiant de requête.";
}
