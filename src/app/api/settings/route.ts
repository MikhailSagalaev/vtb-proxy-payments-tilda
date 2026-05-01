import { NextRequest, NextResponse } from 'next/server';
import { getConfig, updateConfig } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN } from '@/lib/security';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // Rate limiting to prevent config enumeration
    const { allowed } = await checkRateLimit(clientIp, 'settings_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const config = await getConfig();
    // Mask secrets in response — they should never be readable via API
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
    // Rate limiting on settings modifications
    const { allowed } = await checkRateLimit(clientIp, 'settings_write', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Require admin API key for modifications
    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Provide admin API key via Authorization: Bearer <key> header.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    // updateConfig already invalidates the config cache internally
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
