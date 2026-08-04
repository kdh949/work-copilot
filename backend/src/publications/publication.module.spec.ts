import { publicationWriteMode } from './publication.module';

describe('publicationWriteMode', () => {
  it('defaults to the non-writing mock adapter when unset', () => {
    expect(publicationWriteMode(undefined)).toBe('mock');
  });

  it.each([['mock', 'mock']] as const)(
    'accepts the explicit %s mode',
    (value, expected) => {
      expect(publicationWriteMode(value)).toBe(expected);
    },
  );

  it('requires a verified staging contract before enabling real writes', () => {
    expect(() => publicationWriteMode('real')).toThrow(
      'OAuth2 staging contract',
    );
    expect(publicationWriteMode(' REAL ', true)).toBe('real');
  });

  it.each(['', 'mokc', 'enabled'])(
    'fails closed for invalid mode %s',
    (value) => {
      expect(() => publicationWriteMode(value)).toThrow(
        'PUBLICATION_WRITE_MODE',
      );
    },
  );
});
