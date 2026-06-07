'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Shuffle, 
  Play, 
  CheckCircle, 
  Users, 
  Trophy,
  Sparkles,
  RefreshCw,
  Flame
} from 'lucide-react';

const INITIAL_PLAYERS = [
  { id: 'p1', name: 'Spin Doctor', initials: 'SD', gamesPlayed: 8, wins: 5, losses: 3, waitRounds: 0 },
  { id: 'p2', name: 'Lob Star', initials: 'LS', gamesPlayed: 10, wins: 7, losses: 3, waitRounds: 0 },
  { id: 'p3', name: 'Kitchen Cruiser', initials: 'KC', gamesPlayed: 6, wins: 3, losses: 3, waitRounds: 0 },
  { id: 'p4', name: 'Net Cord Ninja', initials: 'NC', gamesPlayed: 7, wins: 4, losses: 3, waitRounds: 0 },
  { id: 'p5', name: 'Erne Expert', initials: 'EE', gamesPlayed: 5, wins: 2, losses: 3, waitRounds: 1 },
  { id: 'p6', name: 'ATP Avenger', initials: 'AA', gamesPlayed: 4, wins: 2, losses: 2, waitRounds: 2 },
  { id: 'p7', name: 'Dink Master', initials: 'DM', gamesPlayed: 12, wins: 9, losses: 3, waitRounds: 3 },
];

const NEW_PLAYER_POOL = [
  { name: 'Third Shot Drop', initials: 'TS' },
  { name: 'Poach Prince', initials: 'PP' },
  { name: 'Kitchen King', initials: 'KK' },
  { name: 'Base Line Brawler', initials: 'BB' },
  { name: 'Paddle Puncher', initials: 'PP' },
  { name: 'Nasty Nelson', initials: 'NN' },
  { name: 'Side Spin Sam', initials: 'SS' }
];

export default function PaddleStackSimulator() {
  const [queue, setQueue] = useState(INITIAL_PLAYERS);
  const [court, setCourt] = useState(null); // null or Array of 4 players
  const [lastMatchResult, setLastMatchResult] = useState(null);
  const [simulatedCount, setSimulatedCount] = useState(0);

  // Add random player
  const handleAddPlayer = () => {
    const poolIndex = Math.floor(Math.random() * NEW_PLAYER_POOL.length);
    const chosen = NEW_PLAYER_POOL[poolIndex];
    const newId = `p_new_${Date.now()}`;
    const newPlayer = {
      id: newId,
      name: chosen.name,
      initials: chosen.initials,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      waitRounds: 0
    };
    
    // Prevent duplicates currently in queue or court
    const nameExists = queue.some(p => p.name === chosen.name) || (court && court.some(p => p.name === chosen.name));
    if (nameExists) return;

    setQueue(prev => [...prev, newPlayer]);
  };

  // Shuffle queue (mix waiting players)
  const handleShuffle = () => {
    if (queue.length < 2) return;
    setQueue(prev => {
      const array = [...prev];
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    });
  };

  // Start match
  const handleStartMatch = () => {
    if (queue.length < 4 || court) return;

    // Grab top 4 players
    const matchPlayers = queue.slice(0, 4);
    const remainingQueue = queue.slice(4);

    // Increment wait rounds for players who didn't get picked
    const updatedQueue = remainingQueue.map(p => ({
      ...p,
      waitRounds: p.waitRounds + 1
    }));

    setQueue(updatedQueue);
    setCourt(matchPlayers);
    setLastMatchResult(null);
  };

  // Finish match
  const handleFinishMatch = () => {
    if (!court) return;

    // Simulate score
    const scoreA = Math.floor(Math.random() * 6) + 6; // 6 to 11
    const scoreB = scoreA === 11 ? Math.floor(Math.random() * 10) : 11;
    const teamAWins = scoreA > scoreB;

    // Update player stats
    const updatedCourtPlayers = court.map((player, index) => {
      const isTeamA = index === 0 || index === 2;
      const isWinner = (isTeamA && teamAWins) || (!isTeamA && !teamAWins);
      return {
        ...player,
        gamesPlayed: player.gamesPlayed + 1,
        wins: player.wins + (isWinner ? 1 : 0),
        losses: player.losses + (isWinner ? 0 : 1),
        waitRounds: 0 // reset wait rounds
      };
    });

    // Send players back to queue
    setQueue(prev => [...prev, ...updatedCourtPlayers]);
    setCourt(null);
    setLastMatchResult({
      teamA: [court[0].name, court[2].name],
      teamB: [court[1].name, court[3].name],
      score: `${scoreA} - ${scoreB}`,
      winner: teamAWins ? 'Team A' : 'Team B'
    });
    setSimulatedCount(prev => prev + 1);
  };

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xl shadow-slate-100 relative overflow-hidden">
      {/* Decorative light color washes */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Simulator Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-700 animate-pulse" />
            <h3 className="text-sm font-extrabold tracking-widest text-emerald-700 uppercase">Live Queue Simulator</h3>
          </div>
          <p className="text-slate-600 text-xs mt-1">Experience the smart paddle stack in action.</p>
        </div>
        
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleAddPlayer}
            className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition"
            title="Add random player to queue"
          >
            <Plus className="h-3.5 w-3.5 text-slate-500" />
            Add Paddle
          </button>
          
          <button
            onClick={handleShuffle}
            disabled={queue.length < 2}
            className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="Mix queue players"
          >
            <Shuffle className="h-3.5 w-3.5 text-slate-500" />
            Shuffle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[440px]">
        {/* Left Side: The Digital Paddle Rack */}
        <div className="flex flex-col bg-slate-50/40 border border-slate-100 rounded-2xl p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-700" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Paddle Stack</span>
            </div>
            <span className="text-[10px] font-bold bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full text-emerald-800 tabular-nums">
              {queue.length} Wait
            </span>
          </div>

          {/* Paddle Queue List */}
          <div className="flex-1 custom-scrollbar space-y-2 overflow-y-auto max-h-[360px] pr-1">
            <AnimatePresence mode="popLayout">
              {queue.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center h-full py-16 text-center text-slate-400"
                >
                  <Users className="h-8 w-8 mb-2 text-slate-300" />
                  <p className="text-xs">Queue is empty</p>
                </motion.div>
              ) : (
                queue.map((player, index) => {
                  const isOnDeck = index < 4 && !court;
                  return (
                    <motion.div
                      key={player.id}
                      layoutId={player.id}
                      layout
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isOnDeck 
                          ? 'bg-emerald-50/80 border-emerald-200/80 shadow-md shadow-emerald-500/5' 
                          : 'bg-white border-slate-200/60 shadow-sm'
                      }`}
                    >
                      {/* Queue position badge */}
                      <span className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                        isOnDeck ? 'bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {index + 1}
                      </span>

                      {/* Avatar */}
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                        isOnDeck ? 'bg-emerald-100 text-emerald-700 border border-emerald-200/40' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {player.initials}
                      </div>

                      {/* Name & details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-slate-800 truncate">{player.name}</p>
                          {player.waitRounds > 0 && !isOnDeck && (
                            <span className="text-[9px] font-bold bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-amber-200/50">
                              <Flame className="h-2.5 w-2.5 text-amber-600 fill-current" />
                              {player.waitRounds}
                            </span>
                          )}
                          {isOnDeck && (
                            <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1 rounded border border-emerald-200/40 tracking-wider uppercase">
                              On Deck
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          {player.gamesPlayed} games · {player.wins}W - {player.losses}L
                        </p>
                      </div>

                      {/* Win rate indicator */}
                      {player.gamesPlayed > 0 && (
                        <div className="text-right">
                          <p className="text-[10px] font-extrabold text-slate-700">
                            {Math.round((player.wins / player.gamesPlayed) * 100)}%
                          </p>
                          <p className="text-[8px] text-slate-600 font-semibold tracking-wider uppercase">Win Rate</p>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Side: Virtual Court */}
        <div className="flex flex-col bg-slate-50/40 border border-slate-100 rounded-2xl p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Active Court</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              court 
                ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' 
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}>
              {court ? 'Match In Progress' : 'Empty Court'}
            </span>
          </div>

          {/* Court Visual representation */}
          <div className="flex-1 flex flex-col justify-between border-2 border-dashed border-slate-200 rounded-xl p-4 bg-slate-50 relative min-h-[260px]">
            {/* Center Net Line */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-slate-200 flex items-center justify-center">
              <span className="bg-white text-slate-600 text-[8px] px-1.5 py-0.5 font-bold uppercase tracking-widest border border-slate-200 rounded-md shadow-sm">
                Net
              </span>
            </div>

            {/* Simulated Players on Court */}
            <AnimatePresence mode="popLayout">
              {court ? (
                <div className="h-full flex flex-col justify-between relative z-10">
                  {/* Team A (Top Side) */}
                  <div className="flex justify-around py-2">
                    <motion.div
                      layoutId={court[0].id}
                      className="bg-emerald-700 text-white font-bold text-xs p-2.5 rounded-xl flex flex-col items-center gap-1 shadow-md shadow-emerald-700/10 w-24 text-center border border-emerald-600"
                    >
                      <span className="text-[10px] font-extrabold uppercase opacity-80">Player 1</span>
                      <span className="truncate w-full block">{court[0].name}</span>
                    </motion.div>
                    
                    <motion.div
                      layoutId={court[2].id}
                      className="bg-emerald-700 text-white font-bold text-xs p-2.5 rounded-xl flex flex-col items-center gap-1 shadow-md shadow-emerald-700/10 w-24 text-center border border-emerald-600"
                    >
                      <span className="text-[10px] font-extrabold uppercase opacity-80">Player 3</span>
                      <span className="truncate w-full block">{court[2].name}</span>
                    </motion.div>
                  </div>

                  {/* Team B (Bottom Side) */}
                  <div className="flex justify-around py-2">
                    <motion.div
                      layoutId={court[1].id}
                      className="bg-sky-700 text-white font-bold text-xs p-2.5 rounded-xl flex flex-col items-center gap-1 shadow-md shadow-sky-700/10 w-24 text-center border border-sky-600"
                    >
                      <span className="text-[10px] font-extrabold uppercase opacity-80">Player 2</span>
                      <span className="truncate w-full block">{court[1].name}</span>
                    </motion.div>

                    <motion.div
                      layoutId={court[3].id}
                      className="bg-sky-700 text-white font-bold text-xs p-2.5 rounded-xl flex flex-col items-center gap-1 shadow-md shadow-sky-700/10 w-24 text-center border border-sky-600"
                    >
                      <span className="text-[10px] font-extrabold uppercase opacity-80">Player 4</span>
                      <span className="truncate w-full block">{court[3].name}</span>
                    </motion.div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center py-12 text-center text-slate-400">
                  <Trophy className="h-10 w-10 text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-600">Ready for Match</p>
                  <p className="text-[10px] text-slate-600 max-w-[160px] mt-1">Requires 4 players in queue to auto-mix and launch.</p>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Action buttons under court */}
          <div className="mt-4 flex gap-2">
            {!court ? (
              <button
                onClick={handleStartMatch}
                disabled={queue.length < 4}
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Simulate Match
              </button>
            ) : (
              <button
                onClick={handleFinishMatch}
                className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-bold py-2.5 px-4 rounded-xl shadow-md transition"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Finish Match
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Simulator Footer - Stats and Simulation updates */}
      <div className="mt-5 border-t border-slate-100 pt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
        {lastMatchResult ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-700 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg shadow-sm"
          >
            <Trophy className="h-3.5 w-3.5 text-amber-500 fill-current" />
            <span>
              Last match: <strong>{lastMatchResult.winner}</strong> won (
              <span className="text-slate-500 font-semibold">{lastMatchResult.score}</span>)
            </span>
          </motion.div>
        ) : (
          <div className="text-[11px] text-slate-600 flex items-center gap-1 font-medium">
            <Sparkles className="h-3 w-3 text-emerald-700 fill-current" />
            <span>Stacking algorithm automatically prevents court-locking</span>
          </div>
        )}

        <div className="text-[10px] text-slate-600 font-semibold tracking-wider uppercase bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm">
          <RefreshCw className="h-3 w-3 text-emerald-700 animate-spin" style={{ animationDuration: '4s' }} />
          Simulated Matches: <strong className="text-slate-800 tabular-nums">{simulatedCount}</strong>
        </div>
      </div>
    </div>
  );
}
