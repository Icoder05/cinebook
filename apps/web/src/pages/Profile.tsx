import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { nameField, phoneField, type User } from '@cinebook/shared';
import { Spinner } from '../components/States';
import { api, setUser } from '../lib/api';
import { logout, useAuth } from '../lib/auth';

const schema = z.object({ name: nameField, phone: phoneField });

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? '', phone: user?.phone ?? '' },
  });

  if (!user) return null;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const r = await api<{ user: User }>('/me', { method: 'PATCH', body: values });
      setUser(r.user);
      reset(values);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update profile');
    }
  });

  return (
    <div className="container-page max-w-xl py-6">
      <h1 className="mb-4 text-2xl font-bold">Profile</h1>
      <form onSubmit={onSubmit} noValidate className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" className="input bg-surface" value={user.email} disabled />
        </div>
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" className="input" {...register('name')} aria-invalid={!!errors.name} />
          {errors.name && <p className="field-error">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Mobile number
          </label>
          <input id="phone" type="tel" className="input" {...register('phone')} aria-invalid={!!errors.phone} />
          {errors.phone && <p className="field-error">{errors.phone.message}</p>}
        </div>
        <button className="btn-primary" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? <Spinner /> : 'Save changes'}
        </button>
      </form>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">Security</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Signed in on another device you don't recognise? Sign out everywhere — every refresh token is revoked.
        </p>
        <button
          className="btn-outline mt-4"
          onClick={async () => {
            await logout(true);
            toast.success('Signed out of all devices');
            navigate('/');
          }}
        >
          Sign out of all devices
        </button>
      </section>
    </div>
  );
}
