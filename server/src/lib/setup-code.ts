import { randomBytes } from 'crypto';

let setupCode: string | null = null;

export function generateSetupCode(): string {
  setupCode = randomBytes(4).toString('hex').toUpperCase().substring(0, 6);
  return setupCode;
}

export function getSetupCode(): string | null {
  return setupCode;
}

export function clearSetupCode(): void {
  setupCode = null;
}

export function validateSetupCode(input: string | undefined): boolean {
  if (!setupCode || !input) return false;
  return input.toUpperCase() === setupCode;
}
