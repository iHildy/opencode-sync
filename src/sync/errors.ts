export class SyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class SyncConfigMissingError extends SyncError {
  constructor(message: string) {
    super('sync_config_missing', message);
  }
}

export class RepoDivergedError extends SyncError {
  constructor(message: string) {
    super('repo_diverged', message);
  }
}

export class RepoPrivateRequiredError extends SyncError {
  constructor(message: string) {
    super('repo_private_required', message);
  }
}

export class RepoVisibilityError extends SyncError {
  constructor(message: string) {
    super('repo_visibility_error', message);
  }
}

export class SyncCommandError extends SyncError {
  constructor(message: string) {
    super('sync_command_error', message);
  }
}
