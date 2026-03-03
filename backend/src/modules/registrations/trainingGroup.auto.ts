export type AutoTrainingGroupCode = 'U9' | 'U11' | 'U13' | 'U15';

type GroupRule = {
  maxAge: number;
  code: AutoTrainingGroupCode;
};

const GROUP_RULES: GroupRule[] = [
  { maxAge: 9, code: 'U9' },
  { maxAge: 11, code: 'U11' },
  { maxAge: 13, code: 'U13' },
  { maxAge: 15, code: 'U15' }
];

export function calculateAgeFromDateOfBirth(dateOfBirth: string, asOfDate = new Date()): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    throw new Error('Invalid date of birth');
  }

  let age = asOfDate.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    asOfDate.getMonth() > dob.getMonth() ||
    (asOfDate.getMonth() === dob.getMonth() && asOfDate.getDate() >= dob.getDate());
  if (!hasBirthdayPassed) {
    age -= 1;
  }
  return age;
}

export function resolveTrainingGroupByAge(age: number): AutoTrainingGroupCode {
  const normalizedAge = Math.max(age, 0);
  for (const rule of GROUP_RULES) {
    if (normalizedAge <= rule.maxAge) {
      return rule.code;
    }
  }
  // For ages above configured ranges, keep player in highest available academy group.
  return 'U15';
}

