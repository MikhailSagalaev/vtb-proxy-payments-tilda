/**
 * Integration-style tests for callback flow.
 * We mock Prisma + VTB status + Tilda notification sender.
 */
jest.mock('@/lib/db', () => {
  const tx = {
    id: 'tx_1',
    orderId: 'order_1',
    orderNumber: 'order_1',
    amount: 1000,
    currency: '398',
    status: 0,
    tildaPaymentId: 'order_1',
    callbackData: null,
  };
  return {
    db: {
      paymentConfig: { findUnique: jest.fn(async () => ({ id: 'default', webhookSecret: '' })) },
      paymentTransaction: {
        findFirst: jest.fn(async ({ where }: any) => (where?.orderId === tx.orderId ? tx : null)),
        update: jest.fn(async () => ({})),
      },
      rateLimitEntry: {
        deleteMany: jest.fn(async () => ({})),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
    },
  };
});

jest.mock('@/lib/vtb', () => ({
  getOrderStatus: jest.fn(async () => ({ orderStatus: 2 })),
  sendTildaNotification: jest.fn(async () => ({ ok: true, attempts: 1 })),
}));

import { POST } from './route';
import { db } from '@/lib/db';
import { sendTildaNotification, getOrderStatus } from '@/lib/vtb';

describe('/api/payment/callback', () => {
  it('confirms paid via VTB and notifies Tilda success once', async () => {
    const req = new Request('http://localhost/api/payment/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '1.2.3.4' },
      body: 'mdOrder=order_1&orderStatus=6',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    expect(getOrderStatus).toHaveBeenCalledWith('order_1');
    expect(sendTildaNotification).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order_1', success: true })
    );
    expect((db as any).paymentTransaction.update).toHaveBeenCalled();
  });
});

