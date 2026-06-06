/**
 * Compact display + tooltip variants of a player's name. Shared by the
 * CourtCard and the score-entry modal so the rule lives in exactly one place.
 *
 * Display rule: first word of `firstName` + last-name initial — e.g.
 *   { firstName: "Christian Genesis", lastName: "Diomampo" } -> "Christian D."
 *   { firstName: "Ace",               lastName: null       } -> "Ace"
 *
 * @param {{firstName?: string, lastName?: string|null}|null|undefined} player
 * @returns {{display: string, full: string}}
 */
/**
 * Where a player's name should link, shared by every surface that renders a
 * clickable player name (paddle rack, Player of the Week, Match History Log,
 * Members tab) so the rule lives in exactly one place:
 *
 *   - the viewer's own player/account → `/profile`
 *   - another registered user        → `/u/<userId>`   (member viewers only)
 *   - a walk-in (no account)         → `/p/<playerId>` (member viewers only)
 *   - otherwise → null — render plain text. Non-members share no arena, so
 *     the profile pages would 404; a missing/unknown target gets no link.
 *
 * @param {{userId?: string|null, playerId?: string|null}} target
 * @param {{viewerUserId?: string|null, viewerIsMember?: boolean}} viewer
 * @returns {string|null}
 */
export function profileHref(
  { userId = null, playerId = null } = {},
  { viewerUserId = null, viewerIsMember = false } = {},
) {
  if (userId) {
    if (viewerUserId && userId === viewerUserId) return '/profile';
    return viewerIsMember ? `/u/${userId}` : null;
  }
  return playerId && viewerIsMember ? `/p/${playerId}` : null;
}

export function formatShortName(player) {
  if (!player) return { display: 'Unknown', full: 'Unknown' };
  const firstName = (player.firstName ?? 'Unknown').trim();
  const firstWord = firstName.split(/\s+/)[0] || firstName;
  const lastName = player.lastName?.trim() ?? '';
  const lastInitial = lastName.charAt(0).toUpperCase();
  return {
    display: lastInitial ? `${firstWord} ${lastInitial}.` : firstWord,
    full: lastName ? `${firstName} ${lastName}` : firstName,
  };
}
