import { randomBytes } from 'crypto';

let setupCode: string | null = null;

export function generateSetupCode(): string {
  setupCode = randomBytes(4).toString('hex').toUpperCase().substring(0, 6);
  return setupCode;
}

export function getSetupCode(): string | null {
  return setupCode;
}

export function getOrCreateSetupCode(): string {
  if (!setupCode) {
    generateSetupCode();
  }
  return setupCode!;
}

export function clearSetupCode(): void {
  setupCode = null;
}

export function validateSetupCode(input: string | undefined): boolean {
  if (!setupCode) {
    const code = getOrCreateSetupCode();
    console.log(`\n========================================`);
    console.log(`  Dashboard setup code: ${code}`);
    console.log(`  (Required for admin account setup)`);
    console.log(`========================================\n`);
  }
  if (!input) return false;
  return input.trim().toUpperCase() === setupCode;
}
