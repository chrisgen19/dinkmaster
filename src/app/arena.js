'use client';

import React, { useState, useTransition } from 'react';
import {
  addPlayers,
  removePlayer,
  shuffleQueue,
  fillCourt,
  endMatch,
  addCourt,
  removeCourt,
  resetArena,
} from './actions';

const playPaddleSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.12);

    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(1200, ctx.currentTime);
    clickOsc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);

    clickGain.gain.setValueAtTime(0.15, ctx.currentTime);
    clickGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, ctx.currentTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);

    osc.start();
    clickOsc.start();

    osc.stop(ctx.currentTime + 0.13);
    clickOsc.stop(ctx.currentTime + 0.05);
  } catch (e) {
    // Audio not supported or not yet allowed by the browser.
  }
};

export default function Arena({ initialState }) {
  const [players, setPlayers] = useState(initialState.players);
  const [queue, setQueue] = useState(initialState.queue);
  const [courts, setCourts] = useState(initialState.courts);
  const [matchHistory, setMatchHistory] = useState(initialState.matchHistory);
  const [history, setHistory] = useState(initialState.history);

  const [isPending, startTransition] = useTransition();

  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [selectedCourtForScore, setSelectedCourtForScore] = useState(null);
  const [team1Score, setTeam1Score] = useState(11);
  const [team2Score, setTeam2Score] = useState(11);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('courts');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [autoMix, setAutoMix] = useState(true);
  const [notification, setNotification] = useState('');

  // Apply a server action result to local state (state, error, notification).
  const applyResult = (result) => {
    if (!result) return;
    setErrorMsg(result.error || '');
    if (result.notification) {
      setNotification(result.notification);
      setTimeout(() => setNotification(''), 5000);
    }
    if (result.state) {
      setPlayers(result.state.players);
      setQueue(result.state.queue);
      setCourts(result.state.courts);
      setMatchHistory(result.state.matchHistory);
      setHistory(result.state.history);
    }
  };

  // Run a server action inside a transition and reconcile the returned state.
  const run = (action, { sound = true } = {}) => {
    startTransition(async () => {
      const result = await action();
      applyResult(result);
      if (sound) playPaddleSound();
    });
  };

  const getPartnershipCount = (p1, p2) => {
    if (!history[p1]) return 0;
    return history[p1][p2] || 0;
  };

  const handleShuffleQueue = () => {
    if (queue.length < 2) return;
    run(() => shuffleQueue());
  };

  const handleFillCourt = (courtId) => {
    run(() => fillCourt(courtId));
  };

  const handleAddPlayers = (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    const names = newPlayerName;
    setNewPlayerName('');
    run(() => addPlayers(names));
  };

  const handleRemovePlayer = (id) => {
    run(() => removePlayer(id));
  };

  const handleTriggerScoreModal = (court) => {
    setSelectedCourtForScore(court);
    setTeam1Score(11);
    setTeam2Score(11);
    setScoreModalOpen(true);
  };

  const handleEndMatchWithScore = (courtId, score1, score2) => {
    setScoreModalOpen(false);
    setSelectedCourtForScore(null);
    run(() => endMatch(courtId, score1, score2, autoMix));
  };

  const handleAddCourt = () => {
    run(() => addCourt());
  };

  const handleRemoveCourt = (id) => {
    run(() => removeCourt(id));
  };

  const confirmReset = () => {
    setShowResetConfirm(false);
    run(() => resetArena());
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-emerald-100 selection:text-slate-900">

      {/* Premium Light Header Banner */}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-50 px-4 py-4 md:px-8 flex flex-wrap justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm-3 5c.83 0 1.5.67 1.5 1.5S9.83 10 9 10s-1.5-.67-1.5-1.5S8.17 7 9 7zm-2 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm6 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3.5-3.5c-.83 0-1.5-.67-1.5-1.5S16.17 7 17 7s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-5-10c-.83 0-1.5-.67-1.5-1.5S12.17 3 13 3s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
              DINKMASTER <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">v2.6</span>
            </h1>
            <p className="text-xs text-slate-500 font-medium">Smart Paddle Stacking & Partnership Mixing</p>
          </div>
        </div>

        {/* Global Stats Indicators */}
        <div className="flex items-center space-x-4 md:space-x-6">
          <div className="hidden sm:flex space-x-3 text-xs">
            <div className="bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 block">Total Players</span>
              <span className="text-sm font-bold text-slate-800">{players.length}</span>
            </div>
            <div className="bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 block">In Queue</span>
              <span className="text-sm font-bold text-emerald-600">{queue.length}</span>
            </div>
            <div className="bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 block">Active Games</span>
              <span className="text-sm font-bold text-sky-600">
                {courts.filter(c => c.status === 'playing').length}
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3.5 py-2.5 rounded-xl border border-red-200/60 transition-all font-semibold shadow-sm"
          >
            Reset Arena
          </button>
        </div>
      </header>

      {/* Dynamic Mixing Notification Toast Banner */}
      {notification && (
        <div className="mx-4 md:mx-8 mt-4 p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center space-x-2">
            <span>✨</span>
            <span>{notification}</span>
          </div>
          <button onClick={() => setNotification('')} className="text-emerald-700 hover:text-emerald-900 font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Main Grid Workspace */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Left Column: Player Administration & Paddle Queue */}
        <div className="lg:col-span-5 space-y-6">

          {/* Quick Add Section */}
          <section className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                Register Players
              </h3>
              <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                Separated by commas
              </span>
            </div>

            <form onSubmit={handleAddPlayers} className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Bradley, Jane, Chloe"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-xl px-4 py-2.5 text-sm outline-none transition text-slate-800 placeholder-slate-400"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-5 py-2.5 rounded-xl transition duration-150 flex items-center justify-center shadow-sm shrink-0"
              >
                Add
              </button>
            </form>

            {errorMsg && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
                <span className="font-bold">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}
          </section>

          {/* Visual Paddle Stack Section */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                    Paddle Rack Stack
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Top 4 paddles will stack into the next available court.</p>
                </div>
                <span className="bg-emerald-50 text-emerald-800 border border-emerald-100/50 text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full shrink-0">
                  {queue.length} Stacked
                </span>
              </div>

              {/* Silo Buster Controls */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/60 items-center justify-between">
                <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoMix}
                    onChange={(e) => setAutoMix(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>Auto-Mix Queue on Multi-Finish</span>
                </label>

                <button
                  onClick={handleShuffleQueue}
                  disabled={queue.length < 2}
                  className="bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1"
                  title="Shuffle everyone currently waiting to break court locking"
                >
                  🔀 Mix Queue
                </button>
              </div>
            </div>

            <div className="p-4 space-y-2.5 max-h-[500px] overflow-y-auto custom-scrollbar bg-slate-50/20">
              {queue.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3">

                  </div>
                  <p className="text-sm font-semibold text-slate-600">The rack is empty</p>
                  <p className="text-xs mt-1 text-slate-400">Register and add players to stack their paddles!</p>
                </div>
              ) : (
                queue.map((playerId, index) => {
                  const player = players.find(p => p.id === playerId);
                  if (!player) return null;

                  const isNextUp = index < 4;

                  return (
                    <div
                      key={playerId}
                      className={`flex items-center justify-between p-3.5 rounded-xl transition-all relative group ${
                        isNextUp
                          ? 'bg-emerald-50/40 border-2 border-emerald-500 shadow-sm'
                          : 'bg-white hover:bg-slate-50 border border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isNextUp ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {index + 1}
                        </div>

                        <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                          isNextUp
                            ? 'border-emerald-200 bg-emerald-100/40 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}>
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2a4 4 0 00-4 4v4.5A5.5 5.5 0 0011.5 16v5a1 1 0 102 0v-5A5.5 5.5 0 0016 10.5V6a4 4 0 00-4-4zm-2 4a2 2 0 114 0v2h-4V6z"/>
                          </svg>
                        </div>

                        <div>
                          <p className="text-sm font-bold text-slate-800">{player.name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            Played: {player.gamesPlayed} (W: {player.wins || 0} - L: {player.losses || 0})
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleRemovePlayer(player.id)}
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:text-red-700 hover:bg-red-100 border border-red-100"
                          title="Remove Player"
                        >
                          ✕
                        </button>
                      </div>

                      {isNextUp && (
                        <span className="absolute -top-2 right-4 text-[8px] tracking-widest uppercase font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full shadow-sm">
                          ON DECK
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Active Courts Grid */}
        <div className="lg:col-span-7 space-y-6">

          <div className="flex justify-between items-center bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveTab('courts')}
                className={`px-4 py-2 text-xs font-extrabold uppercase rounded-lg transition-all ${
                  activeTab === 'courts'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Active Courts
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`px-4 py-2 text-xs font-extrabold uppercase rounded-lg transition-all ${
                  activeTab === 'stats'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Partnership Matrix
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 text-xs font-extrabold uppercase rounded-lg transition-all ${
                  activeTab === 'history'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Match Log
              </button>
            </div>

            <button
              onClick={handleAddCourt}
              className="bg-emerald-600 hover:bg-emerald-700 text-xs font-extrabold text-white px-4 py-2 rounded-lg transition-all flex items-center space-x-1 shadow-sm"
            >
              <span>+ Create Court</span>
            </button>
          </div>

          {activeTab === 'courts' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courts.map((court) => {
                const isPlaying = court.status === 'playing';

                return (
                  <div
                    key={court.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between shadow-sm relative transition-all duration-300 hover:shadow-md"
                  >
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div>
                        <h4 className="font-extrabold text-slate-900 text-sm md:text-base">{court.name}</h4>
                        <div className="flex items-center mt-0.5">
                          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                            isPlaying ? 'bg-sky-500 animate-pulse' : 'bg-slate-300'
                          }`}></span>
                          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                            {isPlaying ? 'Live Match' : 'Vacant'}
                          </span>
                        </div>
                      </div>

                      {!isPlaying && (
                        <button
                          onClick={() => handleRemoveCourt(court.id)}
                          className="text-slate-400 hover:text-red-500 text-sm transition-all p-1"
                          title="Close Court"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="p-5 flex-1 flex flex-col justify-center bg-white">
                      {isPlaying ? (
                        <div className="grid grid-cols-9 items-center gap-2 py-4">

                          {/* Team A Horizontal layout */}
                          <div className="col-span-4 bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
                            <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-2.5">TEAM A</div>
                            <div className="text-xs font-semibold text-slate-800 flex flex-wrap items-center justify-center gap-1">
                              {court.team1.map((id, idx) => {
                                const p = players.find(x => x.id === id);
                                return (
                                  <span key={id} className="truncate">
                                    {p ? p.name.split(' ')[0] : 'Unknown'}
                                    {idx < court.team1.length - 1 ? ' &' : ''}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          <div className="col-span-1 flex justify-center">
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-1 rounded">
                              VS
                            </span>
                          </div>

                          {/* Team B Horizontal layout */}
                          <div className="col-span-4 bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
                            <div className="text-[10px] text-sky-600 font-bold uppercase tracking-wider mb-2.5">TEAM B</div>
                            <div className="text-xs font-semibold text-slate-800 flex flex-wrap items-center justify-center gap-1">
                              {court.team2.map((id, idx) => {
                                const p = players.find(x => x.id === id);
                                return (
                                  <span key={id} className="truncate">
                                    {p ? p.name.split(' ')[0] : 'Unknown'}
                                    {idx < court.team2.length - 1 ? ' &' : ''}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                        </div>
                      ) : (
                        <div className="py-10 text-center border border-dashed border-slate-200 bg-slate-50/50 rounded-xl flex flex-col items-center justify-center">
                          <p className="text-slate-700 font-semibold text-xs">Court is Vacant</p>
                          <p className="text-[11px] text-slate-400 mt-1">Requires 4 players in the queue to start.</p>
                        </div>
                      )}
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-slate-50/30">
                      {isPlaying ? (
                        <button
                          onClick={() => handleTriggerScoreModal(court)}
                          className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-widest transition-all shadow-sm"
                        >
                          Finish Game & Record Score
                        </button>
                      ) : (
                        <button
                          onClick={() => handleFillCourt(court.id)}
                          disabled={queue.length < 4}
                          className={`w-full py-3 rounded-xl font-extrabold text-xs uppercase tracking-widest transition-all shadow-sm ${
                            queue.length >= 4
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/50'
                          }`}
                        >
                          {queue.length >= 4 ? 'Stack Next 4 Paddles' : 'Need 4 Players in Rack'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                  Partnership Pairing Matrix
                </h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  To ensure maximum pairing variety, historical partnerships are tracked dynamically. The active court loader assesses cumulative partnerships for the top 4 players and implements the lineup with the lowest match history score.
                </p>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50 custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="p-3 font-extrabold text-slate-500 border-r border-slate-200 sticky left-0 bg-slate-100">Player</th>
                      {players.map(p => (
                        <th key={p.id} className="p-3 font-extrabold text-slate-500 text-center truncate max-w-[80px]" title={p.name}>
                          {p.name.split(' ')[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map(rowPlayer => (
                      <tr key={rowPlayer.id} className="border-b border-slate-200/60 hover:bg-white transition">
                        <td className="p-3 font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-slate-50">
                          {rowPlayer.name}
                        </td>
                        {players.map(colPlayer => {
                          const isSelf = rowPlayer.id === colPlayer.id;
                          const count = getPartnershipCount(rowPlayer.id, colPlayer.id);

                          return (
                            <td
                              key={colPlayer.id}
                              className={`p-3 text-center border-r border-slate-200/40 font-bold ${
                                isSelf
                                  ? 'bg-slate-100 text-slate-400 font-normal'
                                  : count > 0
                                    ? count >= 3
                                      ? 'bg-amber-50 text-amber-800'
                                      : 'bg-emerald-50 text-emerald-800'
                                    : 'text-slate-400 bg-white'
                              }`}
                            >
                              {isSelf ? '-' : count}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-white border border-slate-200"></span>
                  <span>Never Partnered</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-50 border border-emerald-100"></span>
                  <span>Few Partnerships</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-amber-50 border border-amber-100"></span>
                  <span>Repeated Pairings (Optimized Out)</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in">
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                  Match History Log
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Complete ledger of finished matches, final scores, and team results.
                </p>
              </div>

              {matchHistory.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20">
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3 text-lg">
                    📊
                  </div>
                  <p className="text-sm font-semibold text-slate-600">No matches recorded yet</p>
                  <p className="text-xs mt-1 text-slate-400">Completed game summaries will show up here.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                  {matchHistory.map((match) => {
                    const team1Won = match.score1 > match.score2;
                    const team2Won = match.score2 > match.score1;

                    return (
                      <div key={match.id} className="border border-slate-100 rounded-xl bg-slate-50/50 p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold mb-3">
                          <span>{match.courtName}</span>
                          <span>{new Date(match.timestamp).toLocaleString()}</span>
                        </div>

                        <div className="grid grid-cols-9 items-center gap-2">
                          {/* Team A Horizontal Layout in logs */}
                          <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                            team1Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                          }`}>
                            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team A</div>
                            <div className="text-xs font-semibold text-slate-700 truncate">
                              {match.team1.map(id => players.find(x => x.id === id)?.name.split(' ')[0] || 'Unknown').join(' & ')}
                            </div>
                            {team1Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                          </div>

                          <div className="col-span-3 flex flex-col items-center justify-center">
                            <div className="flex items-center space-x-3 text-lg font-extrabold text-slate-800">
                              <span className={team1Won ? 'text-emerald-600 font-black' : ''}>{match.score1}</span>
                              <span className="text-slate-300 font-normal">:</span>
                              <span className={team2Won ? 'text-emerald-600 font-black' : ''}>{match.score2}</span>
                            </div>
                          </div>

                          {/* Team B Horizontal Layout in logs */}
                          <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                            team2Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                          }`}>
                            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team B</div>
                            <div className="text-xs font-semibold text-slate-700 truncate">
                              {match.team2.map(id => players.find(x => x.id === id)?.name.split(' ')[0] || 'Unknown').join(' & ')}
                            </div>
                            {team2Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* Confirmation Reset Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl animate-scale-up">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                ⚠️
              </div>
              <h3 className="text-base font-extrabold text-slate-900">Reset Arena Session?</h3>
            </div>

            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              This action will reset all active court matchups, wipe partnership diagnostics tracking records, clear match history logs, and reset the initial waiting line.
            </p>

            <div className="flex space-x-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Keep Current Session
              </button>
              <button
                onClick={confirmReset}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md shadow-red-500/10 transition"
              >
                Yes, Reset Arena
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Score Entry Custom Modal */}
      {scoreModalOpen && selectedCourtForScore && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-6 shadow-xl animate-scale-up">
            <div className="mb-4 text-center">
              <h3 className="text-base font-extrabold text-slate-900">Record Match Score</h3>
              <p className="text-xs text-slate-400 mt-0.5">{selectedCourtForScore.name}</p>
            </div>

            {/* Flat Score Inputs with horizontal player names */}
            <div className="flex items-center justify-between gap-4 mb-6">
              {/* Team 1 Minimal Input */}
              <div className="flex-1 text-center">
                <span className="text-[10px] text-emerald-600 font-extrabold tracking-wider block mb-2 uppercase truncate px-1">
                  {selectedCourtForScore.team1.map(id => players.find(x => x.id === id)?.name.split(' ')[0] || 'Unknown').join(' & ')}
                </span>
                <input
                  type="number"
                  value={team1Score}
                  onChange={(e) => setTeam1Score(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-center bg-slate-50 border border-slate-200 rounded-xl py-3 text-xl font-extrabold text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition"
                  placeholder="0"
                />
              </div>

              <div className="text-slate-300 font-extrabold text-xs self-end pb-4">VS</div>

              {/* Team 2 Minimal Input */}
              <div className="flex-1 text-center">
                <span className="text-[10px] text-sky-600 font-extrabold tracking-wider block mb-2 uppercase truncate px-1">
                  {selectedCourtForScore.team2.map(id => players.find(x => x.id === id)?.name.split(' ')[0] || 'Unknown').join(' & ')}
                </span>
                <input
                  type="number"
                  value={team2Score}
                  onChange={(e) => setTeam2Score(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-center bg-slate-50 border border-slate-200 rounded-xl py-3 text-xl font-extrabold text-slate-800 focus:bg-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="flex space-x-2.5 justify-end">
              <button
                onClick={() => {
                  setScoreModalOpen(false);
                  setSelectedCourtForScore(null);
                }}
                className="flex-1 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleEndMatchWithScore(selectedCourtForScore.id, team1Score, team2Score)}
                className="flex-1 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition"
              >
                Save & Recycle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tailwind Animations Setup */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(241, 245, 249, 0.4);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.3);
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.5);
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-fade-in {
          animation: fadeIn 0.15s ease-out forwards;
        }
        .animate-scale-up {
          animation: scaleUp 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
