/**
 * Principal hasil verifikasi access token. Permission TIDAK di sini — dihitung
 * terpisah oleh PermissionService (REST §2).
 */
export type AuthPrincipal = {
  userId: string;
  sessionId: string;
  userType: 'CITIZEN' | 'STAFF';
  roles: string[];
  orgId?: string;
  unitId?: string;
};

export type AuthedRequest = {
  user?: AuthPrincipal;
};
