'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';

const WORDS = [
  'partnership mixing',
  'paddle queueing',
  'stat tracking',
  'open-play scheduling',
  'dupr ratings',
];

export default function HeadlineCycle() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % WORDS.length);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    // reducedMotion="user": motion/react defaults to "never" (it does NOT
    // honor prefers-reduced-motion on its own), so without this wrapper the
    // word would slide every 2.8s for motion-sensitive users. With it, the
    // y-transform is skipped and the swap degrades to an opacity fade.
    <MotionConfig reducedMotion="user">
    <span className="relative inline-block text-left align-bottom overflow-hidden h-[1.25em]">
      {/* Invisible in-flow spacer sized to the WIDEST phrase: the animated
          word below is absolutely positioned (contributes no width), so
          without this the wrapper collapses and overflow-hidden clips long
          words — a fixed min-w can't track font size or the longest entry.
          With the spacer, the box is exactly wide enough for every word at
          any viewport, so clipping is impossible by construction. Keep this
          in sync with the longest WORDS entry. */}
      <span aria-hidden="true" className="invisible whitespace-nowrap font-extrabold pb-1">
        open-play scheduling
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
