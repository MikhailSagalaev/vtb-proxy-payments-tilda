jest.mock('../db', () => {
  const upsert = jest.fn(async ({ update, create }: { update: any; create: any }) => {
    // emulate prisma upsert by returning merged object
    return { id: 'default', ...create, ...update };
  });
  const findUnique = jest.fn(async () => null);
  const create = jest.fn(async (args: any) => ({ id: 'default', ...args.data }));
  return {
    db: {
      paymentConfig: { upsert, findUnique, create },
    },
  };
});

import { updateConfig } from '../vtb';

describe('vtb.updateConfig', () => {
  it('should only persist whitelisted fields', async () => {
    const result = await updateConfig({
      vtbUserName: 'u',
      vtbPassword: 'p',
      gatewayUrl: 'https://example.com',
      currency: '398',
      language: 'ru',
      tildaCallbackUrl: 'https://tilda',
      tildaSecret: 's',
      webhookSecret: 'w',
      adminApiKey: 'k',
      successUrl: 'https://ok',
      failUrl: 'https://fail',
      isTestMode: true,
      // should be ignored
      __proto__: { polluted: true },
      callbackData: 'nope',
      randomField: 'nope',
    } as any);

    expect(result).toMatchObject({
      id: 'default',
      vtbUserName: 'u',
      vtbPassword: 'p',
      gatewayUrl: 'https://example.com',
      currency: '398',
      language: 'ru',
      tildaCallbackUrl: 'https://tilda',
      tildaSecret: 's',
      webhookSecret: 'w',
      adminApiKey: 'k',
      successUrl: 'https://ok',
      failUrl: 'https://fail',
      isTestMode: true,
    });

    expect((result as any).randomField).toBeUndefined();
    expect((result as any).callbackData).toBeUndefined();
  });

  it('should not persist masked secret placeholders', async () => {
    const result = await updateConfig({
      vtbUserName: 'updated-user',
      vtbPassword: '••••••••',
      tildaSecret: '••••••••',
      webhookSecret: '••••••••',
      adminApiKey: '••••••••',
    } as any);

    expect(result).toMatchObject({
      id: 'default',
      vtbUserName: 'updated-user',
    });
    expect((result as any).vtbPassword).toBeUndefined();
    expect((result as any).tildaSecret).toBeUndefined();
    expect((result as any).webhookSecret).toBeUndefined();
    expect((result as any).adminApiKey).toBeUndefined();
  });
});

