import { useState, type FormEvent } from "react";
import type {
  ChildTaskTemplateFieldValue,
  IntegrationProfile,
  IntegrationProfileInput,
} from "./integration-profile.types";

type IntegrationProfileFormProps = {
  profile: IntegrationProfile | null;
  isSaving: boolean;
  onSubmit: (input: IntegrationProfileInput) => Promise<void>;
  onCancelEdit: () => void;
};

type FormState = {
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraClientId: string;
  confluenceClientId: string;
  jiraClientSecret: string;
  confluenceClientSecret: string;
  jiraScopes: string;
  confluenceScopes: string;
  allowedProjectKeys: string;
  allowedSpaceKeys: string;
  briefParentPageId: string;
  childTaskIssueTypeId: string;
  childTaskTemplateFields: string;
};

const toCommaList = (values: string[]): string => values.join(", ");

const parseCommaList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const initialState = (profile: IntegrationProfile | null): FormState => ({
  jiraBaseUrl: profile?.jiraBaseUrl ?? "",
  confluenceBaseUrl: profile?.confluenceBaseUrl ?? "",
  jiraClientId: profile?.jiraClientId ?? "",
  confluenceClientId: profile?.confluenceClientId ?? "",
  jiraClientSecret: "",
  confluenceClientSecret: "",
  jiraScopes: toCommaList(profile?.jiraScopes ?? ["READ"]),
  confluenceScopes: toCommaList(profile?.confluenceScopes ?? ["READ"]),
  allowedProjectKeys: toCommaList(profile?.allowedProjectKeys ?? []),
  allowedSpaceKeys: toCommaList(profile?.allowedSpaceKeys ?? []),
  briefParentPageId: profile?.briefParentPageId ?? "",
  childTaskIssueTypeId: profile?.childTaskIssueTypeId ?? "",
  childTaskTemplateFields: JSON.stringify(
    profile?.childTaskTemplateFields ?? {},
    null,
    2,
  ),
});

export function IntegrationProfileForm({
  profile,
  isSaving,
  onSubmit,
  onCancelEdit,
}: IntegrationProfileFormProps) {
  const [form, setForm] = useState(() => initialState(profile));
  const [formError, setFormError] = useState("");
  const isEditing = profile !== null;

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let childTaskTemplateFields: Record<string, ChildTaskTemplateFieldValue>;

    try {
      const parsed = JSON.parse(form.childTaskTemplateFields || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid child task template");
      }
      childTaskTemplateFields = parsed as Record<
        string,
        ChildTaskTemplateFieldValue
      >;
    } catch {
      setFormError("하위 작업 템플릿 값은 JSON 객체여야 합니다.");
      return;
    }

    setFormError("");
    const input: IntegrationProfileInput = {
      jiraBaseUrl: form.jiraBaseUrl,
      confluenceBaseUrl: form.confluenceBaseUrl,
      jiraClientId: form.jiraClientId,
      confluenceClientId: form.confluenceClientId,
      jiraScopes: parseCommaList(form.jiraScopes),
      confluenceScopes: parseCommaList(form.confluenceScopes),
      allowedProjectKeys: parseCommaList(form.allowedProjectKeys),
      allowedSpaceKeys: parseCommaList(form.allowedSpaceKeys),
      briefParentPageId: form.briefParentPageId.trim(),
      childTaskIssueTypeId: form.childTaskIssueTypeId.trim(),
      childTaskTemplateFields,
    };

    if (form.jiraClientSecret) {
      input.jiraClientSecret = form.jiraClientSecret;
    }
    if (form.confluenceClientSecret) {
      input.confluenceClientSecret = form.confluenceClientSecret;
    }

    await onSubmit(input);
    setForm((current) => ({
      ...current,
      jiraClientSecret: "",
      confluenceClientSecret: "",
    }));
  };

  return (
    <form className="integration-profile-form" onSubmit={submit}>
      <div className="admin-section-heading">
        <div>
          <h2>{isEditing ? "연동 프로필 수정" : "새 연동 프로필"}</h2>
          <p>비밀값은 저장 후 다시 표시되지 않습니다.</p>
        </div>
        {isEditing && (
          <button type="button" className="secondary" onClick={onCancelEdit}>
            새 프로필 만들기
          </button>
        )}
      </div>

      <div className="integration-form-grid">
        <fieldset>
          <legend>Jira</legend>
          <label htmlFor="jira-base-url">HTTPS base URL</label>
          <input
            id="jira-base-url"
            type="url"
            required
            placeholder="https://jira.example.com"
            value={form.jiraBaseUrl}
            onChange={(event) => updateField("jiraBaseUrl", event.target.value)}
          />
          <label htmlFor="jira-client-id">Client ID</label>
          <input
            id="jira-client-id"
            required
            value={form.jiraClientId}
            onChange={(event) =>
              updateField("jiraClientId", event.target.value)
            }
          />
          <label htmlFor="jira-client-secret">
            Client secret {profile?.jiraClientSecretConfigured && "(설정됨)"}
          </label>
          <input
            id="jira-client-secret"
            type="password"
            required={!isEditing}
            autoComplete="new-password"
            aria-describedby="client-secret-help"
            value={form.jiraClientSecret}
            onChange={(event) =>
              updateField("jiraClientSecret", event.target.value)
            }
          />
          <label htmlFor="jira-scopes">허용 OAuth scope</label>
          <input
            id="jira-scopes"
            required
            value={form.jiraScopes}
            onChange={(event) => updateField("jiraScopes", event.target.value)}
          />
          <label htmlFor="jira-projects">허용 프로젝트 키</label>
          <input
            id="jira-projects"
            placeholder="COPILOT, PLATFORM"
            value={form.allowedProjectKeys}
            onChange={(event) =>
              updateField("allowedProjectKeys", event.target.value)
            }
          />
          <label htmlFor="child-task-issue-type">하위 작업 issue type ID</label>
          <input
            id="child-task-issue-type"
            placeholder="예: 10001"
            value={form.childTaskIssueTypeId}
            onChange={(event) =>
              updateField("childTaskIssueTypeId", event.target.value)
            }
          />
          <label htmlFor="child-task-template-fields">
            하위 작업 필수 field 템플릿(JSON)
          </label>
          <textarea
            id="child-task-template-fields"
            rows={5}
            placeholder={'{\n  "customfield_10100": "value"\n}'}
            value={form.childTaskTemplateFields}
            onChange={(event) =>
              updateField("childTaskTemplateFields", event.target.value)
            }
          />
        </fieldset>

        <fieldset>
          <legend>Confluence</legend>
          <label htmlFor="confluence-base-url">HTTPS base URL</label>
          <input
            id="confluence-base-url"
            type="url"
            required
            placeholder="https://confluence.example.com"
            value={form.confluenceBaseUrl}
            onChange={(event) =>
              updateField("confluenceBaseUrl", event.target.value)
            }
          />
          <label htmlFor="confluence-client-id">Client ID</label>
          <input
            id="confluence-client-id"
            required
            value={form.confluenceClientId}
            onChange={(event) =>
              updateField("confluenceClientId", event.target.value)
            }
          />
          <label htmlFor="confluence-client-secret">
            Client secret{" "}
            {profile?.confluenceClientSecretConfigured && "(설정됨)"}
          </label>
          <input
            id="confluence-client-secret"
            type="password"
            required={!isEditing}
            autoComplete="new-password"
            aria-describedby="client-secret-help"
            value={form.confluenceClientSecret}
            onChange={(event) =>
              updateField("confluenceClientSecret", event.target.value)
            }
          />
          <label htmlFor="confluence-scopes">허용 OAuth scope</label>
          <input
            id="confluence-scopes"
            required
            value={form.confluenceScopes}
            onChange={(event) =>
              updateField("confluenceScopes", event.target.value)
            }
          />
          <label htmlFor="confluence-spaces">허용 space 키</label>
          <input
            id="confluence-spaces"
            placeholder="ENG, PRODUCT"
            value={form.allowedSpaceKeys}
            onChange={(event) =>
              updateField("allowedSpaceKeys", event.target.value)
            }
          />
        </fieldset>
      </div>

      <label htmlFor="brief-parent-page-id">브리프 상위 페이지 ID</label>
      <input
        id="brief-parent-page-id"
        required
        value={form.briefParentPageId}
        onChange={(event) =>
          updateField("briefParentPageId", event.target.value)
        }
      />
      <p id="client-secret-help" className="form-help">
        입력한 client secret은 즉시 암호화되어 저장되며 화면이나 API 응답으로
        다시 제공되지 않습니다.
      </p>
      {formError && (
        <p className="message" role="alert">
          {formError}
        </p>
      )}
      <div className="button-row">
        <button type="submit" disabled={isSaving}>
          {isSaving ? "저장 중" : isEditing ? "변경 저장" : "프로필 저장"}
        </button>
      </div>
    </form>
  );
}
