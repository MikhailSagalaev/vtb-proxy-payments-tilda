jest.mock('../db', () => {
  return {
    db: {
      paymentConfig: {
        findUnique: jest.fn(async () => ({ id: 'default', adminApiKey: 'secret-key' })),
      },
    },
  };
});

import { verifyAdminKey } from '../security';

describe('verifyAdminKey', () => {
  it('should reject missing Authorization header when key configured', async () => {
    const req = new Request('http://x', { headers: {} });
    await expect(verifyAdminKey(req)).resolves.toBe(false);
  });

  it('should accept correct Bearer key', async () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer secret-key' } });
    await expect(verifyAdminKey(req)).resolves.toBe(true);
  });

  it('should reject incorrect Bearer key', async () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer wrong' } });
    await expect(verifyAdminKey(req)).resolves.toBe(false);
  });
});

