/**
 * Arena membership roles.
 * - OWNER     — full control: play actions, membership management, rename, transfer.
 * - ORGANIZER — runs the full session (all play actions); no membership control.
 * - MEMBER    — joined viewer; can leave.
 */
export const ROLES = {
  OWNER: 'OWNER',
  ORGANIZER: 'ORGANIZER',
  MEMBER: 'MEMBER',
};

/** True if the role may run the session (add players, run matches, etc.). */
export function canManageArena(role) {
  return role === ROLES.OWNER || role === ROLES.ORGANIZER;
}
