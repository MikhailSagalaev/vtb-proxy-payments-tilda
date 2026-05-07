import { NextRequest, NextResponse } from 'next/server';
import { getConfig, updateConfig } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN, isInsecureMode } from '@/lib/security';
import { db } from '@/lib/db';
import { errorToMeta, getRequestId, logRequest } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logRequest('info', requestId, 'GET /api/settings', { clientIp, insecureMode: isInsecureMode() }, false);
    const { allowed } = await checkRateLimit(clientIp, 'settings_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      logRequest('warn', requestId, 'Rate limit exceeded on settings_read', { clientIp }, false);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Check if this is a first-time setup (no admin key configured)
    const rawConfig = await db.paymentConfig.findUnique({ where: { id: 'default' } });
    const isFirstSetup = !rawConfig?.adminApiKey;

    if (isFirstSetup) {
      logRequest('info', requestId, 'First setup: returning minimal settings', { clientIp }, false);
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
      logRequest('warn', requestId, 'Unauthorized GET /api/settings', { clientIp }, false);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    logRequest('info', requestId, 'Returning masked settings', { clientIp, isTestMode: config.isTestMode }, false);
    // Mask secrets — they should never be readable via API even when authorized
    return NextResponse.json({
      ...config,
      vtbPassword: config.vtbPassword ? '••••••••' : '',
      tildaSecret: config.tildaSecret ? '••••••••' : '',
      webhookSecret: config.webhookSecret ? '••••••••' : '',
      adminApiKey: config.adminApiKey ? '••••••••' : '',
    });
  } catch (error: unknown) {
    logRequest('error', requestId, 'GET /api/settings failed', { clientIp, ...errorToMeta(error) }, false);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const requestId = getRequestId(request.headers);

  try {
    logRequest('info', requestId, 'POST /api/settings', { clientIp, insecureMode: isInsecureMode() }, false);
    const { allowed } = await checkRateLimit(clientIp, 'settings_write', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      logRequest('warn', requestId, 'Rate limit exceeded on settings_write', { clientIp }, false);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Require admin API key (verifyAdminKey allows first-time setup when no key exists)
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      logRequest('warn', requestId, 'Unauthorized POST /api/settings', { clientIp }, false);
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide admin API key via Authorization: Bearer <key> header.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    logRequest('info', requestId, 'Updating config', { clientIp, keys: Object.keys(body || {}) }, false);
    const config = await updateConfig(body);
    logRequest('info', requestId, 'Config updated', { clientIp, isTestMode: config.isTestMode }, false);
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
    logRequest('error', requestId, 'POST /api/settings failed', { clientIp, ...errorToMeta(error) }, false);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
