import type { WidgetPayload } from '../../shared/contracts.js';

declare global {
  interface Window {
    openai?: {
      theme?: 'light' | 'dark';
      locale?: string;
      displayMode?: string;
      toolInput?: unknown;
      toolOutput?: WidgetPayload;
      toolResponseMetadata?: Record<string, unknown>;
      widgetState?: Record<string, unknown>;
      setWidgetState?: (state: Record<string, unknown>) => Promise<void> | void;
      callTool?: (name: string, input: Record<string, unknown>) => Promise<unknown>;
      requestDisplayMode?: (mode: 'inline' | 'pip' | 'fullscreen') => Promise<void> | void;
      openExternal?: (url: string) => Promise<void> | void;
      sendFollowUpMessage?: (message: string) => Promise<void> | void;
    };
  }
}

export {};
