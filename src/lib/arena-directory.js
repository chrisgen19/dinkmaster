/**
 * Split the public arena directory into arenas the signed-in user is attached
 * to and arenas they can discover/request from. Ownership is canonical even if
 * a membership row is missing, so owned arenas still appear under "Your arenas".
 *
 * @param {Array<{id:string,ownerId:string}>} arenas
 * @param {object} options
 * @param {string|null|undefined} options.userId
 * @param {Iterable<string>} options.memberArenaIds
 */
export function partitionArenaDirectory(arenas, { userId, memberArenaIds = [] } = {}) {
  if (!userId) {
    return { yourArenas: [], publicArenas: arenas };
  }

  const memberIds = new Set(memberArenaIds);
  const yourArenas = [];
  const publicArenas = [];

  for (const arena of arenas) {
    if (memberIds.has(arena.id) || arena.ownerId === userId) {
      yourArenas.push(arena);
    } else {
      publicArenas.push(arena);
    }
  }

  return { yourArenas, publicArenas };
}
