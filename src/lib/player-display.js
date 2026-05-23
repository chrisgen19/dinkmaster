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
