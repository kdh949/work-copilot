import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ChildTaskTemplateFieldValue = string | number | boolean | string[];

export type ChildTaskTemplate = {
  issueTypeId: string;
  fields: Record<string, ChildTaskTemplateFieldValue>;
};

export type OAuthScopePolicy = {
  oauthScopes?: {
    jira?: string[];
    confluence?: string[];
  };
  childTaskTemplate?: ChildTaskTemplate;
};

@Entity('integration_profiles')
export class IntegrationProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  jiraBaseUrl: string;

  @Column({ type: 'text' })
  confluenceBaseUrl: string;

  @Column({ type: 'text' })
  jiraClientId: string;

  @Column({ type: 'text' })
  confluenceClientId: string;

  @Column({ type: 'text', nullable: true, select: false })
  jiraClientSecretCiphertext: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  jiraClientSecretIv: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  jiraClientSecretTag: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  confluenceClientSecretCiphertext: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  confluenceClientSecretIv: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  confluenceClientSecretTag: string | null;

  @Column({ type: 'int', default: 1 })
  encryptionKeyVersion: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  allowedProjectKeys: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  allowedSpaceKeys: string[];

  @Column({ type: 'varchar', nullable: true })
  briefParentPageId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  policy: OAuthScopePolicy;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
