import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/primitives/button';
import { Input } from '@/components/primitives/input';
import { Card } from '@/components/primitives/card';
import { LanguageToggle, useT } from '@/i18n';

const BITUNIX_REFERRAL_URL = 'https://www.bitunix.com/register?inviteCode=xmba1f';

export function GrvtOnboardingPage() {
  const t = useT();
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const [exchange, setExchange] = useState<'grvt' | 'bitunix'>('bitunix');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [tradingAddress, setTradingAddress] = useState('');
  const [accountId, setAccountId] = useState('');
  const [subAccountId, setSubAccountId] = useState('');
  const [pending, setPending] = useState(false);
  const needsGrvtFields = exchange === 'grvt';

  // Sub-account is now optional: the backend defaults to accountId
  // when empty, covering the 90% of GRVT users with a single
  // sub-account where both ids match.
  const canSave =
    apiKey.length > 0 &&
    apiSecret.length > 0 &&
    (!needsGrvtFields || /^0x[0-9a-fA-F]{64}$/.test(apiSecret)) &&
    (!needsGrvtFields || /^0x[0-9a-fA-F]{40}$/.test(tradingAddress)) &&
    (!needsGrvtFields || accountId.length > 0) &&
    !pending;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setPending(true);
    try {
      await api.saveGrvtCredentials({
        exchange,
        apiKey,
        apiSecret,
        tradingAddress,
        accountId: accountId || (exchange === 'bitunix' ? 'bitunix' : ''),
        subAccountId: needsGrvtFields ? subAccountId.trim() || undefined : undefined,
      });
      toast.success(exchange === 'bitunix' ? 'Credenciales de Bitunix guardadas' : t('onboarding.grvt.saved'));
      await refreshMe();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error((err as Error).message || t('onboarding.grvt.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-bg-base">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            {exchange === 'bitunix' ? 'Conectar Bitunix' : t('onboarding.grvt.title')}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {exchange === 'bitunix'
              ? 'Pega tus credenciales API de Bitunix Futures para empezar a operar'
              : t('onboarding.grvt.subtitle')}
          </p>
        </div>

        <Card>
          <div className="text-2xs text-text-muted space-y-1 mb-4">
            {exchange === 'bitunix' ? (
              <>
                <p>
                  Necesitas tu API Key y API Secret de Bitunix Futures. El bot usara esas credenciales para leer balance y colocar ordenes del grid.
                </p>
                <p>
                  Si todavia no tienes cuenta, puedes crearla con el referido:{' '}
                  <a
                    href={BITUNIX_REFERRAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Crear cuenta en Bitunix
                  </a>
                  .
                </p>
              </>
            ) : (
              <p>
                {t('onboarding.grvt.instructionsPrefix')}
                <a
                  href="https://grvt.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  grvt.io
                </a>
                {t('onboarding.grvt.instructionsSuffix')}
              </p>
            )}
            <p className="text-warning">
              {exchange === 'bitunix'
                ? 'Tu API Secret se cifra en el servidor con AES-256-GCM. Nunca se guarda en texto plano y solo se descifra en memoria al colocar ordenes en Bitunix.'
                : t('onboarding.grvt.encryptionNote')}
            </p>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Exchange
              </label>
              <select
                value={exchange}
                onChange={(e) => {
                  const next = e.target.value as 'grvt' | 'bitunix';
                  setExchange(next);
                  if (next === 'bitunix') {
                    setTradingAddress('');
                    setAccountId('');
                    setSubAccountId('');
                  }
                }}
                disabled={pending}
                className="w-full h-10 rounded-md border border-border-subtle bg-bg-surface px-3 text-sm text-text-primary"
              >
                <option value="bitunix">Bitunix</option>
                <option value="grvt">GRVT</option>
              </select>
            </div>
            <Input
              label={t('onboarding.grvt.apiKey')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={pending}
              autoComplete="off"
            />
            <Input
              label={exchange === 'bitunix' ? 'API Secret' : t('onboarding.grvt.apiSecret')}
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              disabled={pending}
              autoComplete="off"
              error={
                needsGrvtFields && apiSecret && !/^0x[0-9a-fA-F]{64}$/.test(apiSecret)
                  ? t('onboarding.grvt.apiSecretError')
                  : undefined
              }
            />
            {needsGrvtFields && (
              <>
                <Input
                  label={t('onboarding.grvt.tradingAddress')}
                  value={tradingAddress}
                  onChange={(e) => setTradingAddress(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  error={
                    tradingAddress && !/^0x[0-9a-fA-F]{40}$/.test(tradingAddress)
                      ? t('onboarding.grvt.tradingAddressError')
                      : undefined
                  }
                />
                <Input
                  label={t('onboarding.grvt.accountId')}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                />
              </>
            )}
            {needsGrvtFields && (
              <div className="space-y-1">
                <Input
                  label={t('onboarding.grvt.subAccountId')}
                  value={subAccountId}
                  onChange={(e) => setSubAccountId(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                />
                <p className="text-2xs text-text-muted px-1">
                  {t('onboarding.grvt.subAccountIdHint')}
                </p>
              </div>
            )}

            <Button
              variant="primary"
              type="submit"
              disabled={!canSave}
              className="w-full"
            >
              {pending ? t('onboarding.grvt.saving') : t('onboarding.grvt.saveBtn')}
            </Button>
          </form>
        </Card>

        <p className="text-2xs text-text-muted text-center">
          {exchange === 'bitunix'
            ? 'Puedes actualizar esto luego en Ajustes -> Credenciales Bitunix.'
            : t('onboarding.grvt.canUpdateLater')}
        </p>
      </div>
    </div>
  );
}
