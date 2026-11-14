"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Gentle fade between app pages (templates remount on navigation). Opacity
 * only: a transform here would break `position: fixed` descendants.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="flex flex-1 flex-col"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
