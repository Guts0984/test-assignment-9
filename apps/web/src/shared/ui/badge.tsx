import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-secondary text-secondary-foreground',
        success: 'bg-success text-success-foreground',
        warning: 'bg-warning text-warning-foreground',
        danger: 'bg-destructive text-destructive-foreground',
        info: 'bg-primary text-primary-foreground',
        outline: 'border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export const Badge = ({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
);
