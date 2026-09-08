import { randomBytes } from 'crypto';

interface ResetCodeEntry {
  code: string;
  email: string;
  expiresAt: number;
}

let activeResetCode: ResetCodeEntry | null = null;

const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function generateResetCode(email: string): string {
  const code = randomBytes(4).toString('hex').toUpperCase().substring(0, 6);
  activeResetCode = {
    code,
    email: email.toLowerCase(),
    expiresAt: Date.now() + RESET_CODE_TTL_MS,
  };

  console.log(`\n========================================`);
  console.log(`  Password reset code: ${code}`);
  console.log(`  Account: ${email}`);
  console.log(`  (Valid for 15 minutes)`);
  console.log(`========================================\n`);

  return code;
}

export function validateResetCode(email: string | undefined, inputCode: string | undefined): boolean {
  if (!activeResetCode || !email || !inputCode) return false;

  if (Date.now() > activeResetCode.expiresAt) {
    activeResetCode = null;
    return false;
  }

  const isEmailMatch = activeResetCode.email === email.trim().toLowerCase();
  const isCodeMatch = activeResetCode.code === inputCode.trim().toUpperCase();

  return isEmailMatch && isCodeMatch;
}

export function clearResetCode(): void {
  activeResetCode = null;
}
