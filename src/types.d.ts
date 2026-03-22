// Type declaration for optional playwright dependency
declare module 'playwright' {
  export interface Browser {
    newContext(opts?: { viewport?: { width: number; height: number } }): Promise<BrowserContext>;
    close(): Promise<void>;
  }

  export interface BrowserContext {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export interface Page {
    goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
    screenshot(opts?: { fullPage?: boolean; type?: string }): Promise<Buffer>;
  }

  export const chromium: {
    launch(opts?: { headless?: boolean }): Promise<Browser>;
  };
}
