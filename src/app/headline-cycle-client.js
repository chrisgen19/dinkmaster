'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react';

const WORDS = [
  'partnership mixing',
  'paddle queueing',
  'stat tracking',
  'open-play scheduling',
  'dupr ratings',
];

// Spacer phrase derived from the data so adding a longer entry can't silently
// reintroduce clipping. Character count is a proxy for rendered width — exact
// for the current set; if a future phrase is shorter-but-wider, the measured
// clip check in the PR #135 thread is the way to re-verify.
const LONGEST_WORD = WORDS.reduce((a, b) => (a.length >= b.length ? a : b));

export default function HeadlineCycle() {
  const [index, setIndex] = useState(0);
  // MotionConfig below only softens the slide — it can't stop the interval
  // from swapping words. For reduced-motion users the rotation itself is the
  // motion, so pause it entirely and show a single static phrase.
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) return undefined;
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % WORDS.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  return (
    // reducedMotion="user": motion/react defaults to "never" (it does NOT
    // honor prefers-reduced-motion on its own). Belt-and-braces with the
    // interval pause above: even a one-off entrance animation degrades to a
    // fade for motion-sensitive users.
    <MotionConfig reducedMotion="user">
    <span className="relative inline-block text-left align-bottom overflow-hidden h-[1.25em]">
      {/* Invisible in-flow spacer sized to the WIDEST phrase: the animated
          word below is absolutely positioned (contributes no width), so
          without this the wrapper collapses and overflow-hidden clips long
          words — a fixed min-w can't track font size or the longest entry.
          With the spacer, the box is exactly wide enough for every word at
          any viewport, so clipping is impossible by construction. */}
      <span aria-hidden="true" className="invisible whitespace-nowrap font-extrabold pb-1">
        {LONGEST_WORD}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={WORDS[index]}
          initial={{ y: 25, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -25, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="absolute left-0 bottom-0 whitespace-nowrap bg-gradient-to-r from-emerald-700 via-teal-700 to-indigo-700 bg-clip-text text-transparent font-extrabold pb-1"
        >
          {WORDS[index]}
        </motion.span>
      </AnimatePresence>
    </span>
    </MotionConfig>
  );
}
