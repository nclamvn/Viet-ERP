// ============================================================
// @vierp/sdk — Plugin System
// Extensible plugin architecture for custom modules
// ============================================================

// ==================== Types ====================

export interface ERPPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tier: 'basic' | 'pro' | 'enterprise';
  modules: string[];               // Which ERP modules this plugin extends
  hooks: PluginHook[];
  routes?: PluginRoute[];
  settings?: PluginSetting[];
  activate: (context: PluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

export interface PluginHook {
  event: string;                    // e.g., 'before:invoice.create', 'after:employee.update'
  handler: (data: unknown, context: PluginContext) => Promise<unknown>;
  priority?: number;                // Lower = runs first (default: 100)
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;                     // e.g., '/custom/report'
  handler: (req: Request, context: PluginContext) => Promise<Response>;
}

export interface PluginSetting {
  key: string;
  label: string;
  labelVi: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'json';
  default: unknown;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

export interface PluginContext {
  tenantId: string;
  userId: string;
  tier: 'basic' | 'pro' | 'enterprise';
  settings: Record<string, unknown>;
  api: {
    get: (path: string) => Promise<unknown>;
    post: (path: string, body: unknown) => Promise<unknown>;
    put: (path: string, body: unknown) => Promise<unknown>;
    delete: (path: string) => Promise<unknown>;
  };
  events: {
    publish: (event: string, data: unknown) => Promise<void>;
    subscribe: (event: string, handler: (data: unknown) => Promise<void>) => void;
  };
  logger: {
    info: (message: string, data?: unknown) => void;
    warn: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  };
}

// ==================== Plugin Manager ====================

export class PluginManager {
  private plugins: Map<string, ERPPlugin> = new Map();
  private hookRegistry: Map<string, Array<{ pluginId: string; handler: PluginHook['handler']; priority: number }>> = new Map();
  private routeRegistry: Map<string, { pluginId: string; handler: PluginRoute['handler'] }> = new Map();

  /**
   * Install and activate a plugin
   */
  async install(plugin: ERPPlugin, context: PluginContext): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} is already installed`);
    }

    // Register hooks
    for (const hook of plugin.hooks) {
      const key = hook.event;
      if (!this.hookRegistry.has(key)) {
        this.hookRegistry.set(key, []);
      }
      this.hookRegistry.get(key)!.push({
        pluginId: plugin.id,
        handler: hook.handler,
        priority: hook.priority || 100,
      });
      // Sort by priority
      this.hookRegistry.get(key)!.sort((a, b) => a.priority - b.priority);
    }

    // Register routes
    if (plugin.routes) {
      for (const route of plugin.routes) {
        const key = `${route.method}:${route.path}`;
        this.routeRegistry.set(key, {
          pluginId: plugin.id,
          handler: route.handler,
        });
      }
    }

    // Activate
    await plugin.activate(context);
    this.plugins.set(plugin.id, plugin);

    console.log(`[PLUGIN] Installed: ${plugin.name} v${plugin.version}`);
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    // Deactivate
    if (plugin.deactivate) {
      await plugin.deactivate();
    }

    // Remove hooks
    for (const [event, handlers] of this.hookRegistry.entries()) {
      this.hookRegistry.set(event, handlers.filter(h => h.pluginId !== pluginId));
    }

    // Remove routes
    for (const [key, route] of this.routeRegistry.entries()) {
      if (route.pluginId === pluginId) {
        this.routeRegistry.delete(key);
      }
    }

    this.plugins.delete(pluginId);
    console.log(`[PLUGIN] Uninstalled: ${plugin.name}`);
  }

  /**
   * Execute hooks for an event (waterfall pattern)
   */
  async executeHooks(event: string, data: unknown, context: PluginContext): Promise<unknown> {
    const handlers = this.hookRegistry.get(event);
    if (!handlers || handlers.length === 0) return data;

    let result = data;
    for (const { handler } of handlers) {
      result = await handler(result, context);
    }
    return result;
  }

  /**
   * Handle a plugin route request
   */
  async handleRoute(method: string, path: string, req: Request, context: PluginContext): Promise<Response | null> {
    const key = `${method}:${path}`;
    const route = this.routeRegistry.get(key);
    if (!route) return null;
    return route.handler(req, context);
  }

  /**
   * List installed plugins
   */
  listPlugins(): Array<{ id: string; name: string; version: string; modules: string[] }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      modules: p.modules,
    }));
  }
}
