/**
 * Arena invite modes — shared by the server actions, loaders, and the client
 * Share UI. Kept free of any Node-only imports so it can be bundled into a
 * client component (the code generator lives separately in `invite-code.js`).
 *
 * - AUTO_JOIN — redeeming makes the person a MEMBER + queued player at once.
 * - APPROVAL  — redeeming files a JoinRequest for an owner/organizer to approve.
 */
export const INVITE_MODES = {
  AUTO_JOIN: 'AUTO_JOIN',
  APPROVAL: 'APPROVAL',
};

/** True if `value` is a valid {@link INVITE_MODES} member. */
export function isInviteMode(value) {
  return value === INVITE_MODES.AUTO_JOIN || value === INVITE_MODES.APPROVAL;
}

/** Human label for an invite mode (UI badges, CTAs). */
export function inviteModeLabel(mode) {
  return mode === INVITE_MODES.AUTO_JOIN ? 'Auto-join' : 'Approval';
}
