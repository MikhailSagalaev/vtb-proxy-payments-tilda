import {
  generateTildaSignature,
  verifyTildaSignature,
  generateWebhookSignature,
  verifyWebhookSignature,
  sanitizeString,
  sanitizeOrderId,
  parseAmount,
  maskSensitive,
  extractCustomerEmail,
  isValidCustomerEmail,
} from '../security';

describe('Security Library', () => {
  describe('Tilda Signatures', () => {
    const secret = 'test-secret';
    const params = {
      payment_id: '12345',
      payment_amount: '1000.50',
      payment_subject: 'Test Order',
      some_empty_param: '',
    };

    it('should generate correct HMAC-SHA256 signature', () => {
      const signature = generateTildaSignature(params, secret);
      expect(signature).toBeDefined();
      expect(signature.length).toBe(64); // SHA-256 hex length
    });

    it('should verify correct signature', () => {
      const signature = generateTildaSignature(params, secret);
      const isValid = verifyTildaSignature(params, secret, signature);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect signature', () => {
      const isValid = verifyTildaSignature(params, secret, 'invalid-signature');
      expect(isValid).toBe(false);
    });

    it('should ignore empty parameters in signature generation', () => {
      const paramsWithEmpty = { ...params, empty: '' };
      const sig1 = generateTildaSignature(params, secret);
      const sig2 = generateTildaSignature(paramsWithEmpty, secret);
      expect(sig1).toBe(sig2);
    });
  });

  describe('VTB Webhook Signatures', () => {
    const secret = 'vtb-secret';
    const body = 'orderId=123&status=2';

    it('should verify correct webhook signature', () => {
      const signature = generateWebhookSignature(body, secret);
      const isValid = verifyWebhookSignature(body, secret, signature);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect webhook signature', () => {
      const isValid = verifyWebhookSignature(body, secret, 'wrong-sig');
      expect(isValid).toBe(false);
    });
  });

  describe('Sanitization', () => {
    it('should sanitize strings (remove HTML tags)', () => {
      const input = '<script>alert(1)</script> Hello & World "Test"';
      const sanitized = sanitizeString(input);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('scriptalert(1)/script');
      expect(sanitized).toContain('&amp;');
      expect(sanitized).toContain('&quot;');
    });

    it('should sanitize order IDs', () => {
      expect(sanitizeOrderId('order-123!@#')).toBe('order-123');
      expect(sanitizeOrderId('test_order.456')).toBe('test_order.456');
    });
  });

  describe('Customer email from Tilda params', () => {
    it('extracts standard Email field', () => {
      expect(extractCustomerEmail({ Email: '  buyer@example.com  ' })).toBe('buyer@example.com');
    });

    it('extracts by key name containing email', () => {
      expect(extractCustomerEmail({ customer_email: 'a@b.co' })).toBe('a@b.co');
    });

    it('rejects invalid values', () => {
      expect(extractCustomerEmail({ Email: 'not-an-email' })).toBeUndefined();
      expect(isValidCustomerEmail('bad')).toBe(false);
    });
  });

  describe('Amount Parsing', () => {
    it('should parse valid amounts', () => {
      expect(parseAmount('1000')).toBe(100000);
      expect(parseAmount('1000.50')).toBe(100050);
      expect(parseAmount('1000,50')).toBe(100050);
      expect(parseAmount('1 000.50')).toBe(100050);
    });

    it('should return null for invalid amounts', () => {
      expect(parseAmount('abc')).toBeNull();
      expect(parseAmount('-100')).toBeNull();
      expect(parseAmount('0')).toBeNull();
    });
  });

  describe('Masking', () => {
    it('should mask sensitive keys', () => {
      const data = {
        public_id: '123',
        password: 'my-secret-password',
        tildaSecret: 'very-secret',
        passwordPresent: true,
        passwordLength: 9,
      };
      const masked = maskSensitive(data);
      expect(masked.public_id).toBe('123');
      expect(masked.password).toBe('my-***');
      expect(masked.tildaSecret).toBe('ver***');
      expect(masked.passwordPresent).toBe('***');
      expect(masked.passwordLength).toBe('***');
    });
  });
});
