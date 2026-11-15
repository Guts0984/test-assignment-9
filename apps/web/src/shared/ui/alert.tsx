import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const alertVariants = cva('rounded-md border p-3 text-sm', {
  variants: {
    tone: {
      info: 'border-border bg-muted',
      error: 'border-destructive bg-destructive/10 text-foreground',
      warning: 'border-warning bg-warning/15',
      success: 'border-success bg-success/10',
    },
  },
  defaultVariants: { tone: 'info' },
});

export const Alert = ({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={cn(alertVariants({ tone }), className)}
    {...props}
  />
);
