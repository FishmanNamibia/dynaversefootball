import crypto from 'node:crypto';

export function createPlayerCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DYN-${year}-${suffix}`;
}

export function createInvoiceNumber(prefix = 'INV'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${yyyy}${mm}${dd}-${suffix}`;
}

