import { zodResolver } from '@hookform/resolvers/zod';
import { Ticket } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, type Location } from 'react-router-dom';
import { toast } from 'sonner';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from '@cinebook/shared';
import { Spinner } from '../components/States';
import { ApiError } from '../lib/api';
import { login, signup, useAuth } from '../lib/auth';

function useRedirect() {
  const location = useLocation();
  const state = location.state as { from?: Location; reason?: string } | null;
  const from = state?.from ? `${state.from.pathname}${state.from.search}` : '/';
  return { from, reason: state?.reason, state };
}

function Shell({ title, children, reason }: { title: string; children: React.ReactNode; reason?: string }) {
  return (
    <div className="container-page flex justify-center py-10">
      <div className="card w-full max-w-md p-6 md:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white">
            <Ticket className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold">{title}</h1>
          {reason && <p className="text-sm text-ink-muted">{reason}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

type FieldProps = { id: string; label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>;

// forwardRef so react-hook-form's register() can attach to the underlying input.
const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ id, label, error, ...rest }, ref) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className="input"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        {...rest}
      />
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
});

export function Login() {
  const { status } = useAuth();
  const { from, reason, state } = useRedirect();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (status === 'authed') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await login(values);
      toast.success('Welcome back!');
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not sign in');
    }
  });

  return (
    <Shell title="Sign in" reason={reason}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        {formError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {formError}
          </p>
        )}
        <button className="btn-primary w-full py-3" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        New to CineBook?{' '}
        <Link to="/signup" state={state} className="font-medium text-brand">
          Create an account
        </Link>
      </p>
    </Shell>
  );
}

export function Signup() {
  const { status } = useAuth();
  const { from, reason, state } = useRedirect();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

  if (status === 'authed') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await signup(values);
      toast.success('Account created');
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') setError('email', { message: err.message });
      else setFormError(err instanceof Error ? err.message : 'Could not sign up');
    }
  });

  return (
    <Shell title="Create your account" reason={reason}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field id="name" label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Field id="email" label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field
          id="phone"
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <p className="-mt-2 text-xs text-ink-muted">At least 8 characters with a letter and a number.</p>
        {formError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {formError}
          </p>
        )}
        <button className="btn-primary w-full py-3" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" state={state} className="font-medium text-brand">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}
