/**
 * Where a player's name should link, shared by every surface that renders a
 * clickable player name (paddle rack, Player of the Week, Match History Log,
 * Members tab, court cards) so the rule lives in exactly one place:
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

/**
 * Does a name match a search query? Every whitespace-separated query token
 * must appear somewhere in the name — so "le r" matches "Leah RC" and "ali d"
 * matches "Aljomar D." — case-insensitively. A blank/empty query matches
 * everything. The shared primitive behind every name search (the player
 * pickers via `filterPlayersByName`, and the Members-tab lists, which carry a
 * single display-name string rather than first/last fields).
 *
 * @param {string} name - the full name to test
 * @param {string} query
 * @returns {boolean}
 */
export function matchesNameQuery(name, query) {
  const tokens = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = (name ?? '').toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Alphabetical comparator on the name a row actually displays, case-insensitive.
 *
 * For lists that MIX row shapes — the prep roster shows arena members, which
 * carry one full-name string, alongside walk-ins, which carry separate
 * first/last fields — every row must be compared on the same key. A
 * first-name-then-last-name comparator reads the member's whole name on one
 * side and only the walk-in's first name on the other, which sorts walk-in
 * "Alex Brown" above member "Alex Adams". Normalizing to `displayName` first
 * and comparing that is the fix.
 *
 * @param {{displayName?: string}} a
 * @param {{displayName?: string}} b
 * @returns {number} standard Array#sort comparator result
 */
export function byDisplayName(a, b) {
  const an = (a?.displayName ?? '').trim();
  const bn = (b?.displayName ?? '').trim();
  return an.localeCompare(bn, undefined, { sensitivity: 'base' });
}

/**
 * Case-insensitive name filter for the player pick lists (the skip-pick
 * replacement modal and the court-edit substitute picker), keyed off the
 * `firstName`/`lastName` shape those lists use. Returns the SAME array when
 * the query is blank (cheap identity for the common case).
 *
 * @param {Array<{firstName?: string, lastName?: string|null}>} players
 * @param {string} query
 * @returns {Array} the matching subset (same array when the query is blank)
 */
export function filterPlayersByName(players, query) {
  if (!(query ?? '').trim()) return players;
  return players.filter((p) => matchesNameQuery(`${p?.firstName ?? ''} ${p?.lastName ?? ''}`, query));
}
