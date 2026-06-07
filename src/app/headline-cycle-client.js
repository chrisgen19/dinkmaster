'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

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
    <span className="relative inline-block min-w-[240px] md:min-w-[320px] text-left align-bottom overflow-hidden h-[1.25em]">
      <AnimatePresence mode="wait">
        <motion.span
          key={WORDS[index]}
          initial={{ y: 25, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -25, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="absolute left-0 bottom-0 bg-gradient-to-r from-emerald-700 via-teal-700 to-indigo-700 bg-clip-text text-transparent font-extrabold pb-1"
        >
          {WORDS[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
