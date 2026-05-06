import { NextRequest, NextResponse } from 'next/server';
import { getConfig, updateConfig } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN } from '@/lib/security';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    const { allowed } = await checkRateLimit(clientIp, 'settings_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Check if this is a first-time setup (no admin key configured)
    const rawConfig = await db.paymentConfig.findUnique({ where: { id: 'default' } });
    const isFirstSetup = !rawConfig?.adminApiKey;

    if (isFirstSetup) {
      // First time — return minimal info so the UI can show the setup wizard
      return NextResponse.json({
        firstSetup: true,
        isTestMode: true,
        adminApiKey: '',
      });
    }

    // After first setup — require admin key for ALL config access
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    // Mask secrets — they should never be readable via API even when authorized
    return NextResponse.json({
      ...config,
      vtbPassword: config.vtbPassword ? '••••••••' : '',
      tildaSecret: config.tildaSecret ? '••••••••' : '',
      webhookSecret: config.webhookSecret ? '••••••••' : '',
      adminApiKey: config.adminApiKey ? '••••••••' : '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    const { allowed } = await checkRateLimit(clientIp, 'settings_write', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Require admin API key (verifyAdminKey allows first-time setup when no key exists)
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide admin API key via Authorization: Bearer <key> header.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const config = await updateConfig(body);
    return NextResponse.json({
      success: true,
      config: {
        ...config,
        vtbPassword: '••••••••',
        tildaSecret: '••••••••',
        webhookSecret: '••••••••',
        adminApiKey: '••••••••',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
