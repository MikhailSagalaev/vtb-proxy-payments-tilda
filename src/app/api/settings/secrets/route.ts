import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/vtb';
import { verifyAdminKey, checkRateLimit, getClientIp, RATE_LIMIT_MAX_ADMIN, isInsecureMode } from '@/lib/security';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    const { allowed } = await checkRateLimit(clientIp, 'settings_secrets_read', RATE_LIMIT_MAX_ADMIN);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const isAuthorized = await verifyAdminKey(request);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Safe default: never expose secrets unless explicitly enabled on server.
    // In insecure test mode, allow reveal so the one-page setup is debuggable.
    const allow = isInsecureMode() || (process.env.ALLOW_SECRET_READ || '').toLowerCase() === 'true';
    if (!allow) {
      return NextResponse.json(
        { error: 'Secret reveal is disabled. Set ALLOW_SECRET_READ=true on server to enable.' },
        { status: 403 }
      );
    }

    const config = await getConfig();
    return NextResponse.json({
      vtbPassword: config.vtbPassword || '',
      tildaSecret: config.tildaSecret || '',
      webhookSecret: config.webhookSecret || '',
      adminApiKey: config.adminApiKey || '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

