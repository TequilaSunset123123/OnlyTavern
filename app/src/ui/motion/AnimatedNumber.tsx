// Copied from motion-primitives (components/core/animated-number.tsx), MIT, Copyright (c)
// 2024 ibelick; see THIRD_PARTY_NOTICES.md. Changed: no `cn` helper (plain class join),
// always a span (no `as`: it made a new component on every render), and an optional
// `format` for money.
import { motion, type SpringOptions, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  format?: (value: number) => string;
};

export function AnimatedNumber({
  value,
  className,
  springOptions,
  format = (current) => Math.round(current).toLocaleString(),
}: AnimatedNumberProps) {
  const spring = useSpring(value, springOptions);
  const display = useTransform(spring, (current) => format(current));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return (
    <motion.span className={['tabular-nums', className].filter(Boolean).join(' ')}>
      {display}
    </motion.span>
  );
}
