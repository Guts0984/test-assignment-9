import { Loader2 } from 'lucide-react';

export const Spinner = ({ label }: { label: string }) => (
  <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    {label}
  </span>
);
