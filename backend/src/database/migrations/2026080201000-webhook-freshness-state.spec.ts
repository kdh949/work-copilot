import { QueryRunner } from 'typeorm';
import { WebhookFreshnessState1785613400000 } from './2026080201000-webhook-freshness-state';

describe('WebhookFreshnessState1785613400000', () => {
  it('adds only a review timestamp to publication recovery metadata', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new WebhookFreshnessState1785613400000().up(queryRunner);

    expect(statements.join('\n')).toContain('"reviewRequiredAt"');
    expect(statements.join('\n')).not.toMatch(
      /rawContent|maskedBrief|providerBody|accessToken/,
    );
  });
});
