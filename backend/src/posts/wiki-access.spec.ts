import { canAccessWiki } from './wiki-access';

describe('canAccessWiki', () => {
  const engineeringEmployee = {
    role: 'employee',
    department: '엔지니어링',
  };

  it('allows an employee to read common and own-department wiki documents', () => {
    expect(canAccessWiki(engineeringEmployee, '공통')).toBe(true);
    expect(canAccessWiki(engineeringEmployee, '엔지니어링')).toBe(true);
  });

  it('does not allow an employee to read another department wiki document', () => {
    expect(canAccessWiki(engineeringEmployee, '인사')).toBe(false);
  });

  it('allows an administrator to read every department wiki document', () => {
    expect(canAccessWiki({ role: 'admin', department: '인사' }, '엔지니어링')).toBe(true);
  });
});
