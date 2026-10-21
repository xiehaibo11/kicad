// SPDX-License-Identifier: AGPL-3.0-only
// Third-party model providers for the KiCad chat.
//
// DeepSeek exposes an Anthropic-compatible Messages API, so the Claude Agent SDK
// can use DeepSeek models by overriding the endpoint, credentials and model name
// through environment variables.  The key is resolved from, in order: VS Code
// SecretStorage, the kicadAgent.deepseek.apiKey setting, DEEPSEEK_API_KEY, and
// the user-level config file ~/.kicad-agent/deepseek.json.  Keys never appear in
// logs or in the repository.
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ProviderModel {
    id: string;
    label: string;
}

export const DEEPSEEK_MODELS: ProviderModel[] = [
    { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
];

const SECRET_KEY = 'kicadAgent.deepseek.apiKey';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';

export interface DeepSeekCredentials {
    apiKey: string;
    baseUrl: string;
    source: string;
}

function userConfigPath(): string {
    return path.join(os.homedir(), '.kicad-agent', 'deepseek.json');
}

interface UserConfig {
    apiKey?: string;
    baseUrl?: string;
}

function readUserConfig(): UserConfig {
    try {
        const raw = fs.readFileSync(userConfigPath(), 'utf8');
        const parsed = JSON.parse(raw) as UserConfig;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function configuredBaseUrl(): string {
    const cfg = vscode.workspace.getConfiguration('kicadAgent');
    return (cfg.get<string>('deepseek.baseUrl', '') || '').trim();
}

/**
 * Resolve the DeepSeek credentials that this session should use.  SecretStorage
 * requires the extension context; pass undefined from call sites without one
 * (the setting, environment and user file are still consulted).
 */
export async function resolveDeepSeekCredentials(
    context?: vscode.ExtensionContext
): Promise<DeepSeekCredentials | undefined> {
    const cfg = vscode.workspace.getConfiguration('kicadAgent');
    const file = readUserConfig();

    let apiKey = '';
    let source = '';

    if (context) {
        try {
            apiKey = (await context.secrets.get(SECRET_KEY)) ?? '';
            if (apiKey) {
                source = 'SecretStorage';
            }
        } catch {
            // SecretStorage can be unavailable in some hosts; fall through.
        }
    }

    if (!apiKey) {
        apiKey = cfg.get<string>('deepseek.apiKey', '') ?? '';
        if (apiKey) {
            source = 'setting kicadAgent.deepseek.apiKey';
        }
    }

    if (!apiKey) {
        apiKey = process.env.DEEPSEEK_API_KEY ?? '';
        if (apiKey) {
            source = 'DEEPSEEK_API_KEY';
        }
    }

    if (!apiKey && typeof file.apiKey === 'string') {
        apiKey = file.apiKey;
        if (apiKey) {
            source = userConfigPath();
        }
    }

    if (!apiKey) {
        return undefined;
    }

    const baseUrl = configuredBaseUrl() || (typeof file.baseUrl === 'string' ? file.baseUrl.trim() : '') || DEFAULT_BASE_URL;
    const endpoint = new URL(baseUrl);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new Error('DeepSeek endpoint must be an HTTP(S) URL without embedded credentials.');
    }
    return { apiKey: apiKey.trim(), baseUrl: baseUrl.replace(/\/+$/, ''), source };
}

export function isDeepSeekModel(model?: string): boolean {
    return !!model && model.toLowerCase().startsWith('deepseek');
}

/**
 * Apply the provider environment for a DeepSeek model.  Returns false when the
 * model is DeepSeek but no credentials are configured, so the caller can fail
 * with an actionable error instead of sending the request to Anthropic.
 */
export async function applyProviderEnvironment(
    context: vscode.ExtensionContext | undefined,
    env: Record<string, string>,
    model: string | undefined
): Promise<boolean> {
    if (!isDeepSeekModel(model)) {
        return true;
    }

    const credentials = await resolveDeepSeekCredentials(context);

    if (!credentials) {
        return false;
    }

    // Route every request, including the small/fast and alias models, to the
    // provider endpoint so no request leaks back to api.anthropic.com.
    env.ANTHROPIC_BASE_URL = credentials.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = credentials.apiKey;
    env.ANTHROPIC_API_KEY = credentials.apiKey;
    env.ANTHROPIC_MODEL = model as string;
    env.ANTHROPIC_SMALL_FAST_MODEL = model as string;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model as string;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model as string;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model as string;
    return true;
}

export function registerProviderCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('kicadAgent.deepseek.setKey', async () => {
            const value = await vscode.window.showInputBox({
                title: 'DeepSeek API key',
                prompt: 'Stored in VS Code SecretStorage, not in settings.json.',
                password: true,
                ignoreFocusOut: true
            });

            if (!value || !value.trim()) {
                return;
            }

            await context.secrets.store(SECRET_KEY, value.trim());
            void vscode.window.showInformationMessage('DeepSeek API key saved.');
        }),

        vscode.commands.registerCommand('kicadAgent.deepseek.clearKey', async () => {
            await context.secrets.delete(SECRET_KEY);
            void vscode.window.showInformationMessage('DeepSeek API key removed from SecretStorage.');
        }),

        vscode.commands.registerCommand('kicadAgent.deepseek.status', async () => {
            const credentials = await resolveDeepSeekCredentials(context);

            if (!credentials) {
                void vscode.window.showWarningMessage(
                    'DeepSeek is not configured. Run "Kicad: Set DeepSeek API Key".'
                );
                return;
            }

            void vscode.window.showInformationMessage(
                `DeepSeek configured: ${credentials.baseUrl} (key source: ${credentials.source}). ` +
                `Select "DeepSeek Flash" or "DeepSeek V4 Pro" in the chat model dropdown.`
            );
        })
    );
}
