'use client';

import { useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { ChevronDown } from 'lucide-react';

const FAQ_ITEMS = [
  {
    question: 'What is digital paddle stacking?',
    answer: 'Traditional open-play sessions use physical racks or whiteboards where players stack their paddles to wait for their turn. Dinkmaster digitalizes this stack. It manages the queue on any device, tracks wait times, and automatically sets up matches, eliminating arguments and paper sheets.'
  },
  {
    question: 'How does the smart partnership mixing work?',
    answer: 'Dinkmaster does not just stack paddles; it mixes players fairly. The system rotates players so that you avoid playing with the same four partners all session. It balances match configurations to ensure everyone gets a social, varied, and competitive open play.'
  },
  {
    question: 'Is Dinkmaster optimized for mobile court-side use?',
    answer: 'Yes! Dinkmaster is fully responsive and built mobile-first. You can install it directly as a PWA (Progressive Web App) on your smartphone. Organizers can check in players, log scores, and manage courts right from their phone at the net.'
  },
  {
    question: 'Does it support player stats and ratings?',
    answer: 'Absolutely. Every game played in your arena updates win/loss records, win rates, streaks, and a skill rating system. We also track weekly leaderboard stats, allowing players to view their progress and keep matches balanced.'
  },
  {
    question: 'Is it free to use?',
    answer: 'Yes! Dinkmaster is free. You can create arenas, invite players, schedule sessions, and run open-play paddle stacks without any credit card or hidden setup wizards.'
  }
];

export default function FAQAccordion() {
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleToggle = (index) => {
    setExpandedIndex(prevIndex => (prevIndex === index ? null : index));
  };

  return (
    // reducedMotion="user": motion/react defaults to "never", so the expand
    // height animation would run for motion-sensitive users without this.
    <MotionConfig reducedMotion="user">
    <div className="w-full max-w-3xl mx-auto space-y-3">
      {FAQ_ITEMS.map((item, idx) => {
        const isExpanded = expandedIndex === idx;
        return (
          <div
            key={idx}
            className="border border-slate-200/80 bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition duration-200"
          >
            <button
              onClick={() => handleToggle(idx)}
              className="w-full flex items-center justify-between p-5 text-left font-sans font-bold text-slate-800 hover:text-emerald-700 transition"
              aria-expanded={isExpanded}
            >
              <span className="text-base md:text-lg tracking-tight">{item.question}</span>
              <span className={`p-1.5 rounded-full bg-slate-50 text-slate-500 border border-slate-100 transition-transform duration-300 ${
                isExpanded ? 'rotate-180 bg-emerald-50 text-emerald-700 border-emerald-100' : ''
              }`}>
                <ChevronDown className="h-4 w-4" />
              </span>
            </button>
            
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                >
                  <div className="px-5 pb-5 pt-1 text-sm text-slate-500 leading-relaxed border-t border-slate-50">
                    {item.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
    </MotionConfig>
  );
}
