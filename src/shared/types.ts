export interface ResourceSnapshot {
  system: {
    cpuPercent: number;
    ramPercent: number;
    ramUsedGB: number;
    ramTotalGB: number;
    gpuPercent: number | null;
  };
  claude: {
    cpuPercent: number;
    ramPercent: number;
    ramMB: number;
    pidCount: number;
  };
  timestamp: number;
}

export interface CompactStatus {
  enabled: boolean;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  vaultCount: number;
  lastVaultFile: string | null;
}

export interface CompactConfig {
  vault_max_entries: number;
  vault_transcript_tail_bytes: number;
  log_enabled: boolean;
}

export interface GitRepoState {
  found: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  staged: number;
  modified: number;
  untracked: number;
}

export interface GitHubRepoInfo {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  updatedAt: string;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  date: string;
  htmlUrl: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
  isDefault: boolean;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  authorLogin: string;
  authorAvatarUrl: string | null;
  baseRef: string;
  headRef: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commentCount: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  authorLogin: string;
  authorAvatarUrl: string | null;
  labels: { name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commentCount: number;
}

export interface GitHubAuthState {
  hasToken: boolean;
  login: string | null;
  scopes: string[];
  encryptionAvailable: boolean;
  encrypted: boolean;
}

export type LMMPhase = 'raw' | 'nodes' | 'reflect' | 'synth';
export type LMMVariant = 'quick' | 'deep';

export interface LMMSettings {
  enabled: boolean;
  journalDir: string;
  variant: LMMVariant;
}

export interface LMMCycleSummary {
  id: string;
  title: string;
  created: string;
  modified: string;
  currentPhase: LMMPhase;
  filledPhases: LMMPhase[];
}

export interface LMMCycle extends LMMCycleSummary {
  phases: {
    raw: string;
    nodes: string;
    reflect: string;
    synth: string;
  };
}

export interface Snippet {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  modifiedAt: string;
}

export interface NotificationSettings {
  enabled: boolean;
  notifyOnPtyExit: boolean;
  notifyOnSyncError: boolean;
}

export interface SyncSettings {
  enabled: boolean;
  owner: string | null;
  repo: string | null;
  deviceName: string;
  branch: string;
  consentAt: string | null;
  debounceMs: number;
}

export interface SyncStatus {
  configured: boolean;
  enabled: boolean;
  ghConnected: boolean;
  ghScopeOk: boolean;
  ghScopes: string[];
  localVaultCount: number;
  pushedCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingCount: number;
}

export interface LocalVault {
  name: string;
  size: number;
  modified: string;
  pushed: boolean;
}

export interface RemoteVault {
  name: string;
  size: number;
  sha: string;
  path: string;
  htmlUrl: string;
}

export interface VaultPreview {
  name: string;
  size: number;
  sessionId: string | null;
  contextTokens: number | null;
  turnCount: number | null;
  cwd: string | null;
  transcriptTailExcerpt: string;
  transcriptTailBytes: number;
}

export type AuthBackendMode = 'local-stub' | 'http';

export interface AuthBackend {
  mode: AuthBackendMode;
  baseUrl: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  user: AuthUser;
  issuedAt: string;
  expiresAt: string | null;
}

export interface AuthState {
  signedIn: boolean;
  session: AuthSession | null;
  backend: AuthBackend;
  encryptionAvailable: boolean;
}

export interface SyncedSettings {
  theme: string | null;
  lmm: {
    enabled: boolean;
    variant: LMMVariant;
  } | null;
  // GitHub PAT is INTENTIONALLY excluded — encryption key is device-local
  // and the token loses its security properties if synced.
  updatedAt: string | null;
}

export interface AuthCredentials {
  email: string;
  password: string;
  allowPlaintextToken?: boolean;
}

// Session / split-pane layout (Phase 7c) -------------------------------------

/**
 * A node in the terminal split tree. `pane` is a leaf hosting one PTY. `split`
 * is a 2-child container with a direction and percentage sizes that sum to
 * 100. The tree is kept intentionally simple — n-ary splits can always be
 * built from nested binary splits.
 */
export type SplitNode = SplitPaneNode | SplitContainerNode;

export interface SplitPaneNode {
  type: 'pane';
  /** Opaque stable id; must match `^[A-Za-z0-9_\-:]+$`, ≤ 64 chars. */
  id: string;
  /** Best-effort cwd to restore the PTY in; null = home dir. */
  cwd: string | null;
}

export interface SplitContainerNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  sizes: [number, number];
  children: [SplitNode, SplitNode];
}

export type SessionPanelId =
  | 'terminal'
  | 'commands'
  | 'resources'
  | 'github'
  | 'compact'
  | 'lmm'
  | 'sync'
  | 'auth'
  | 'settings';

export interface SessionState {
  version: number;
  activePanel: SessionPanelId;
  /** Theme preset name; null = renderer default. */
  theme: string | null;
  layout: SplitNode;
}

// The full ElectronAPI shape lives in src/declarations.d.ts as an ambient
// Window typing. Don't redeclare it here — keep this file for serializable
// IPC payload types only.
