// ============================================================
// @vierp/sdk — REST API Client
// Type-safe client for consuming ERP APIs from external apps
// ============================================================

import type { ApiResponse, PaginationParams, PaginationMeta, Customer, Product, Employee, Supplier } from '@vierp/shared';

// ==================== Configuration ====================

export interface ERPClientConfig {
  baseUrl: string;                    // e.g., https://erp.example.com/api
  apiKey: string;                     // API key for authentication
  tenantId?: string;                  // Optional tenant override
  timeout?: number;                   // Request timeout in ms (default: 30000)
  retries?: number;                   // Retry count (default: 3)
  onError?: (error: ERPClientError) => void;
}

export class ERPClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ERPClientError';
  }
}

// ==================== Main Client ====================

export class ERPClient {
  private config: ERPClientConfig;

  constructor(config: ERPClientConfig) {
    this.config = { timeout: 30000, retries: 3, ...config };
  }

  // Module-specific sub-clients
  get customers() { return new ResourceClient<Customer>(this, '/master/customers'); }
  get products() { return new ResourceClient<Product>(this, '/master/products'); }
  get employees() { return new ResourceClient<Employee>(this, '/master/employees'); }
  get suppliers() { return new ResourceClient<Supplier>(this, '/master/suppliers'); }

  get hrm() { return new ModuleClient(this, '/hrm'); }
  get crm() { return new ModuleClient(this, '/crm'); }
  get mrp() { return new ModuleClient(this, '/mrp'); }
  get accounting() { return new ModuleClient(this, '/acc'); }
  get pm() { return new ModuleClient(this, '/pm'); }
  get otb() { return new ModuleClient(this, '/otb'); }

  // ==================== HTTP Methods ====================

  async get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, params);
  }

  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'X-API-Key': this.config.apiKey,
    };

    if (this.config.tenantId) {
      headers['X-Tenant-ID'] = this.config.tenantId;
    }

    let lastError: Error | null = null;
    const retries = this.config.retries || 3;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await response.json() as ApiResponse<T>;

        if (!response.ok) {
          const error = new ERPClientError(
            data.error?.message || `HTTP ${response.status}`,
            response.status,
            data.error?.code || 'HTTP_ERROR',
            data.error?.details
          );
          if (this.config.onError) this.config.onError(error);
          throw error;
        }

        return data;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on 4xx errors
        if (error instanceof ERPClientError && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new Error('Request failed');
  }
}

// ==================== Resource Client (CRUD) ====================

export class ResourceClient<T> {
  constructor(
    private client: ERPClient,
    private basePath: string
  ) {}

  async list(params?: PaginationParams & Record<string, string>): Promise<{ data: T[]; meta: PaginationMeta }> {
    const queryParams: Record<string, string> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) queryParams[key] = String(value);
      }
    }
    const response = await this.client.get<T[]>(this.basePath, queryParams);
    return { data: response.data || [], meta: response.meta! };
  }

  async get(id: string): Promise<T> {
    const response = await this.client.get<T>(this.basePath, { id });
    if (!response.data) throw new ERPClientError('Not found', 404, 'NOT_FOUND');
    return response.data;
  }

  async getByCode(code: string): Promise<T> {
    const response = await this.client.get<T>(this.basePath, { code });
    if (!response.data) throw new ERPClientError('Not found', 404, 'NOT_FOUND');
    return response.data;
  }

  async create(data: Partial<T>): Promise<T> {
    const response = await this.client.post<T>(this.basePath, data);
    return response.data!;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const response = await this.client.put<T>(`${this.basePath}?id=${id}`, data);
    return response.data!;
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`${this.basePath}?id=${id}`);
  }

  async bulk(action: 'create' | 'update' | 'delete', records: Partial<T>[]): Promise<{
    total: number; succeeded: number; failed: number;
  }> {
    const response = await this.client.post<any>(this.basePath, {
      bulk: true, action, records,
    });
    return response.data;
  }
}

// ==================== Module Client ====================

export class ModuleClient {
  constructor(
    private client: ERPClient,
    private basePath: string
  ) {}

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const response = await this.client.get<T>(`${this.basePath}${path}`, params);
    return response.data!;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.client.post<T>(`${this.basePath}${path}`, body);
    return response.data!;
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await this.client.put<T>(`${this.basePath}${path}`, body);
    return response.data!;
  }

  async delete<T>(path: string): Promise<void> {
    await this.client.delete(`${this.basePath}${path}`);
  }
}
