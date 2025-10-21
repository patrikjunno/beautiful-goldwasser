// src/lib/auth.ts
export type JwtClaims = Record<string, unknown> & { admin?: boolean; role?: string };

export function hasAdminClaim(claims?: JwtClaims | null): boolean {
  return !!(claims && (claims.admin === true || claims.role === "admin"));
}
