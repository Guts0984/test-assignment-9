import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const field =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) => (
  <input className={cn(field, 'h-10', className)} {...props} />
);

export const Textarea = ({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) => (
  <textarea className={cn(field, 'min-h-[72px]', className)} {...props} />
);

export const Select = ({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) => (
  <select className={cn(field, 'h-10', className)} {...props} />
);
