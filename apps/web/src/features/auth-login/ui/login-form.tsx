'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LIMITS } from '@app/shared';
import { homeFor } from '@/entities/session/model';
import { login } from '@/entities/session/api';
import { isApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/query-keys';
import { useRouter } from '@/shared/i18n/navigation';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

export const LoginForm = () => {
  const t = useTranslations('auth');
  const common = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();

  // Same rules as the server's LoginBody (from @app/shared), with messages in the user's language.
  const schema = z.object({
    username: z
      .string()
      .min(1, t('usernameRequired'))
      .regex(
        new RegExp(`^[a-zA-Z0-9._-]{${LIMITS.usernameMin},${LIMITS.usernameMax}}$`),
        t('usernameFormat'),
      ),
    password: z.string().min(1, t('passwordRequired')).max(LIMITS.passwordMax),
  });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { username: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      router.replace(homeFor(me.role));
    },
  });

  const serverMessage = (() => {
    const e = mutation.error;
    if (!e) return null;
    if (isApiError(e) && e.status === 401) return t('invalid');
    if (isApiError(e) && e.status === 429) return t('rateLimited');
    if (isApiError(e) && e.code === 'NETWORK') return common('serverUnreachable');
    return common('somethingWrong');
  })();

  return (
    <form
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      noValidate
      className="flex flex-col gap-4"
    >
      {serverMessage ? <Alert tone="error">{serverMessage}</Alert> : null}
      <Field label={t('username')} error={form.formState.errors.username?.message}>
        {(p) => <Input {...p} autoComplete="username" autoFocus {...form.register('username')} />}
      </Field>
      <Field label={t('password')} error={form.formState.errors.password?.message}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        )}
      </Field>
      <Button type="submit" size="lg" disabled={mutation.isPending}>
        {mutation.isPending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
};
