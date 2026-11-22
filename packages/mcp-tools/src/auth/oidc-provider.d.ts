/**
 * Minimal local typings for the subset of `oidc-provider` 9.13.3 that Aura
 * uses (the package ships no types). Kept deliberately narrow so any new use
 * of the library has to be declared, and reviewed, here first.
 */
declare module 'oidc-provider' {
  import type { IncomingMessage, ServerResponse } from 'http';

  export interface AdapterPayload {
    [key: string]: unknown;
    grantId?: string;
    uid?: string;
    userCode?: string;
    consumed?: number;
  }

  export interface Adapter {
    upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void>;
    find(id: string): Promise<AdapterPayload | undefined>;
    findByUserCode(userCode: string): Promise<AdapterPayload | undefined>;
    findByUid(uid: string): Promise<AdapterPayload | undefined>;
    consume(id: string): Promise<void>;
    destroy(id: string): Promise<void>;
    revokeByGrantId(grantId: string): Promise<void>;
  }

  export interface InteractionDetails {
    uid: string;
    prompt: { name: string; reasons: string[]; details: Record<string, unknown> };
    params: Record<string, unknown> & { client_id?: string; scope?: string };
    session?: { accountId?: string; uid?: string };
    grantId?: string;
  }

  export interface AccessTokenInstance {
    accountId?: string;
    clientId?: string;
    grantId?: string;
    scope?: string;
    aud?: string | string[];
    exp?: number;
    isExpired: boolean;
    jti: string;
    save(): Promise<string>;
    destroy(): Promise<void>;
  }

  export interface GrantInstance {
    jti: string;
    accountId?: string;
    clientId?: string;
    addOIDCScope(scope: string): void;
    addResourceScope(resource: string, scope: string): void;
    save(): Promise<string>;
    destroy(): Promise<void>;
  }

  export interface ClientInstance {
    clientId: string;
  }

  export class Provider {
    constructor(issuer: string, configuration?: Record<string, unknown>);
    issuer: string;
    proxy: boolean;
    callback(): (req: IncomingMessage, res: ServerResponse) => void;
    cookieName(type: 'session' | 'interaction' | 'resume'): string;
    interactionDetails(req: IncomingMessage, res: ServerResponse): Promise<InteractionDetails>;
    interactionResult(req: IncomingMessage, res: ServerResponse, result: Record<string, unknown>, options?: { mergeWithLastSubmission?: boolean }): Promise<string>;
    on(event: string, listener: (...args: any[]) => void): this;
    AccessToken: {
      new (fields: Record<string, unknown>): AccessTokenInstance;
      find(value: string, options?: { ignoreExpiration?: boolean }): Promise<AccessTokenInstance | undefined>;
    };
    Grant: {
      new (fields: { accountId: string; clientId: string }): GrantInstance;
      find(id: string): Promise<GrantInstance | undefined>;
    };
    Client: {
      find(id: string): Promise<ClientInstance | undefined>;
    };
  }

  export class Check {
    constructor(reason: string, description: string, error: string, check: (ctx: any) => boolean | Promise<boolean>);
    static REQUEST_PROMPT: true;
    static NO_NEED_TO_PROMPT: false;
  }
  export interface PromptPolicy {
    checks: { add(check: Check, index?: number): void };
  }
  export const interactionPolicy: {
    base(): PromptPolicy[] & { get(name: string): PromptPolicy };
    Check: typeof Check;
  };

  export const errors: {
    InvalidTarget: new (description?: string) => Error;
    [name: string]: new (...args: any[]) => Error;
  };

  export default Provider;
}
